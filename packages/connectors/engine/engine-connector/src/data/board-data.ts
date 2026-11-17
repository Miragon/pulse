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
 * with the failure of that read, and any other failed read leaves its number out, never 0.
 *
 * A build is kept per caller and board for BOARD_FLOOR_MS (`createOwnerCache`), its `asOf` the
 * start of its reads, but never one that missed a read or holds an undecided reading. A build the
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
import { boardReadsOf, type ReadLog, refusedReads } from "./board-reads.js"

/** How long a build answers for its caller and board: the floor under a board's engine load. */
export const BOARD_FLOOR_MS = 30_000

/** Builds kept per board: one per caller; past it the least recently used goes. */
const BOARD_CACHE_ENTRIES = 64

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
function sourceOf(name: string, resolve: BoardEngineResolver, log: ReadLog): EngineSource {
  try {
    return { name, reads: boardReadsOf(resolve(name), log) }
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
  /** Every read answered and every reading decided: only such a build is kept. */
  readonly complete: boolean
}

async function buildBoard(entry: EngineBoard, resolve: BoardEngineResolver): Promise<BoardBuild> {
  const asOf = new Date().toISOString()
  const log: ReadLog = { failed: false }
  const sources = entry.board.engines.map((name) => sourceOf(name, resolve, log))
  const model = await BoardBuilder.build(entry.board, sources)
  if (log.cancelled !== undefined) throw log.cancelled
  const data = BoardJson.of(model, { failureOf, notes: entry.notes })
  return { data: { ...data, asOf }, complete: !log.failed && !hasUndecidedReading(model) }
}

/** The board `entry` built now, over the engines its file names. */
export async function buildBoardData(
  entry: EngineBoard,
  resolve: BoardEngineResolver,
): Promise<BoardStartData> {
  return (await buildBoard(entry, resolve)).data
}

const boards = createOwnerCache<BoardBuild>({
  maxEntries: BOARD_CACHE_ENTRIES,
  ttlMs: BOARD_FLOOR_MS,
  now: () => Date.now(),
  keep: ({ complete }) => complete,
})

/** The board `entry` for this caller: a build of the last BOARD_FLOOR_MS, else one built now. */
export async function cachedBoardData(
  entry: EngineBoard,
  resolve: BoardEngineResolver,
): Promise<BoardStartData> {
  return (await boards(entry, entry.id, () => buildBoard(entry, resolve))).data
}
