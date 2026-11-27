/**
 * A board of the server's board files (`engine-boards.ts`), built for the board feed: the board
 * builder of @miragon/pulse-board, the one Pulse for VS Code and Pulse for Orca run, over the board
 * reads of each engine the board names, resolved by name under the call (invariant 2), and handed
 * on in the one JSON form of a built board (`BoardJson.of`), so a board shows the same numbers on
 * every surface.
 *
 * A board's numbers degrade per engine and tile instead of failing the call: an engine whose
 * profile the server refused shows failed with ENGINE_PROFILE_REFUSED and is asked nothing, a name
 * no profile carries shows not configured, an engine that fails to say what it is shows failed
 * with the failure of that read, as does one whose definitions read fails as misconfigured (a
 * Camunda 8 cluster without secondary storage: the board builder's rule), and any other failed
 * read leaves its number out, never 0. Each engine gets BOARD_ENGINE_DEADLINE_MS from the start of
 * the build (the builder's deadline per engine): an engine that has not answered by then fails as
 * unreachable, or shows its numbers not read, and the others' tiles read on time.
 *
 * Each read of a build is kept per engine on a floor of its own (`board-floor.ts`), so the next
 * build within BOARD_FLOOR_MS reads only what this one missed, and the build's `asOf` is its own
 * start, or, when earlier, the start of the oldest read it took from the floor. A read the deadline
 * cut leaves that floor as the build ends (`leaveFloor`), whether or not the call's signal aborts
 * it: the next build asks that engine anew while the others answer from the floor, and only a build
 * that overlaps it shares it. A build is kept per caller and board for BOARD_FLOOR_MS
 * (`createOwnerCache`), but never one that missed a read, one whose read was still out when the
 * build ended, one that holds an undecided reading or one that took an answer an earlier build
 * read: the floor of its reads answers the next call, so no number outlives its floor. A build the
 * caller cancelled fails, so a call that shared it reads again.
 */

import type { FailureData } from "@miragon/pulse-board"
import {
  BoardBuilder,
  BoardJson,
  type BoardModel,
  type EngineSource,
} from "@miragon/pulse-board/builder"
import { RuntimeError } from "@miragon/pulse-engine-core"
import {
  type BoardFiles,
  boardProblemSentence,
  type EngineBoard,
  type RefusedBoard,
} from "../board-files.js"
import { createOwnerCache } from "../lib/engine/per-engine.js"
import {
  EngineProfileRefusedError,
  type RuntimeEngine,
  UnknownEngineError,
} from "../lib/engine/resolve-engine.js"
import type { BoardStartData } from "../view-models.board.js"
import {
  BOARD_FLOOR_MS,
  BOARD_READ_FLOORS,
  type BoardReadFloors,
  NO_FLOORS,
} from "./board-floor.js"
import { boardReadsOf, leaveFloor, newReadLog, type ReadLog, refusedReads } from "./board-reads.js"

/** How long each engine of a board has to answer its reads, from the start of the build. */
export const BOARD_ENGINE_DEADLINE_MS = 15_000

/**
 * Callers whose build a board keeps, one each (a board is one build); past it the least recently
 * active caller's goes: 64 builds per board at most.
 */
const BOARD_CACHE_CALLERS = 64

/**
 * The engine a board names, as the call resolves it by name (`resolveRuntimeEngine`, never the
 * default), of any dialect the server reads.
 */
export type BoardEngineResolver = (name: string) => RuntimeEngine

/** A board id the server shows no board for: the call lists the ones it shows. */
class UnknownBoardError extends Error {
  readonly code = "UNKNOWN_BOARD" as const
  constructor(id: string, known: readonly string[]) {
    super(
      known.length === 0
        ? `Unknown board id "${id}": this server shows no board.`
        : `Unknown board id "${id}". Boards: ${known.join(", ")}.`,
    )
    this.name = "UnknownBoardError"
  }
}

/** A board whose file gives no board: the call names its problems in the format's words. */
class BoardRefusedError extends Error {
  readonly code = "BOARD_REFUSED" as const
  constructor({ id, file, problems }: RefusedBoard) {
    super(
      `Board "${id}" cannot be shown. Its file ${file} gives no board: ${problems.map(boardProblemSentence).join("; ")}. Ask whoever runs this server to fix it.`,
    )
    this.name = "BoardRefusedError"
  }
}

/** The board `id` names among `files`; throws when it names a refused file or none. */
export function boardOf(files: BoardFiles | undefined, id: string): EngineBoard {
  const board = files?.boards.find((entry) => entry.id === id)
  if (board !== undefined) return board
  const refused = files?.refused.find((entry) => entry.id === id)
  if (refused !== undefined) throw new BoardRefusedError(refused)
  throw new UnknownBoardError(id, files?.boards.map((entry) => entry.id) ?? [])
}

/**
 * A failed engine's failure: a refused profile's code with the text a tool call to it gives, else
 * the engine contract's failure kind of the read with its message and the hint it carries (what
 * to do about a Camunda 8 cluster's refusal, say).
 */
function failureOf(error: unknown): FailureData {
  if (error instanceof EngineProfileRefusedError) {
    return { code: error.code, message: `[${error.code}] ${error.message}` }
  }
  if (RuntimeError.is(error)) {
    const { failure, message, hint } = error
    return { code: failure, message: hint === undefined ? message : `${message} ${hint}` }
  }
  return {
    code: "unexpectedResponse",
    message: error instanceof Error ? error.message : String(error),
  }
}

/** What the board builder reads of the engine `name`: its reads, a refusal, or nothing. */
function sourceOf(
  name: string,
  resolve: BoardEngineResolver,
  log: ReadLog,
  floors: BoardReadFloors,
): EngineSource {
  try {
    return { name, reads: boardReadsOf(resolve(name), log, floors) }
  } catch (error) {
    if (error instanceof EngineProfileRefusedError) return { name, reads: refusedReads(error) }
    if (error instanceof UnknownEngineError) return { name }
    throw error
  }
}

const hasUndecidedReading = (model: BoardModel): boolean =>
  model.rows.some((row) =>
    row.some((tile) => tile.kind === "counter" && tile.readings.some((r) => r.undecided === true)),
  )

interface BoardBuild {
  readonly data: BoardStartData
  /** Every read its own, answered in time, and every reading decided: only such a build is kept. */
  readonly complete: boolean
}

/** Whether every read of the build started with it, answered in time, and none failed. */
const answeredAll = (log: ReadLog, started: number): boolean =>
  log.out.size === 0 && !log.failed && (log.oldest ?? started) >= started

async function buildBoard(
  entry: EngineBoard,
  resolve: BoardEngineResolver,
  floors: BoardReadFloors,
): Promise<BoardBuild> {
  const started = Date.now()
  const log = newReadLog()
  const sources = entry.board.engines.map((name) => sourceOf(name, resolve, log, floors))
  const model = await BoardBuilder.build(entry.board, sources, {
    engineDeadlineMs: BOARD_ENGINE_DEADLINE_MS,
  }).finally(() => leaveFloor(log))
  if (log.cancelled !== undefined) throw log.cancelled
  const data = BoardJson.of(model, { failureOf, notes: entry.notes })
  const asOf = new Date(Math.min(started, log.oldest ?? started)).toISOString()
  const complete = answeredAll(log, started) && !hasUndecidedReading(model)
  return { data: { ...data, asOf }, complete }
}

/** The board `entry` built now, over the engines its file names, each of its reads made now. */
export async function buildBoardData(
  entry: EngineBoard,
  resolve: BoardEngineResolver,
): Promise<BoardStartData> {
  return (await buildBoard(entry, resolve, NO_FLOORS)).data
}

const boards = createOwnerCache<BoardBuild>({
  maxEntries: 1,
  maxCallers: BOARD_CACHE_CALLERS,
  ttlMs: BOARD_FLOOR_MS,
  now: () => Date.now(),
  keep: ({ complete }) => complete,
})

/**
 * The board `entry` for this caller: a build of the last BOARD_FLOOR_MS, else one built now over
 * the reads of each engine kept as long (`BOARD_READ_FLOORS`).
 */
export async function cachedBoardData(
  entry: EngineBoard,
  resolve: BoardEngineResolver,
): Promise<BoardStartData> {
  return (await boards(entry, entry.id, () => buildBoard(entry, resolve, BOARD_READ_FLOORS))).data
}
