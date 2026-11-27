/**
 * The floor under a board's reads: each read a board's build makes of an engine is kept per
 * configured engine and per CALLER (`createHeldCache` over `callerCacheKey`: a renewed token reads
 * anew, under passthrough auth the engine decides per token what a caller may read), per read and
 * its arguments, for BOARD_FLOOR_MS from its start. A build that missed one engine (its deadline
 * passed, a read failed) is not kept (`board-data.ts`), and the next build within the floor reads
 * only what it missed: the other engines answer from here. Builds that overlap in time share a
 * read still out. One the deadline cut leaves the floor as its build ends (`leaveFloor` in
 * `board-reads.ts`), in every host, whether or not its transport is aborted: on the server the
 * SDK aborts a call's reads once the call answered, a host without a request signal lets the read
 * run on. So the next build asks that engine anew, and a late answer is kept nowhere. A failed
 * read is not kept, and neither is a count that is only a lower bound, which a counter's threshold
 * may leave undecided (a build that holds an undecided reading reads it again). A diagram's XML is
 * no read of this floor: it goes through the one XML cache, kept for good. Each answer carries when
 * its read started, so a build says how old its oldest number is (`asOf`). A board built now
 * (`buildBoardData`) reads through none of it (`NO_FLOORS`).
 */

import type { BoardReads } from "@miragon/pulse-board/builder"
import { createHeldCache, type HeldRead, runtimeEngineKey } from "../lib/engine/per-engine.js"
import type { RuntimeEngine } from "../lib/engine/resolve-engine.js"

/** How long a build of a board, and each of its reads, answers again for the same caller. */
export const BOARD_FLOOR_MS = 30_000

/** Answers per engine and read at most; past it the least recently used one goes. */
const BOARD_READ_ENTRIES = 256

/** The answer of one of a board's reads, and when that read started (ms since the epoch). */
interface FlooredAnswer<T> {
  readonly value: T
  readonly at: number
}

/**
 * The floor of one read: the answer of `read` for `args` on `engine`, kept for BOARD_FLOOR_MS,
 * and the handle that takes it off the floor while it is out.
 */
export type BoardReadFloor<T> = (
  engine: RuntimeEngine,
  args: readonly unknown[],
  read: () => Promise<T>,
) => HeldRead<FlooredAnswer<T>>

type Answer<Read extends keyof BoardReads> = Awaited<ReturnType<BoardReads[Read]>>

/** A floor for each of a board's reads but the diagram's XML. */
export interface BoardReadFloors {
  readonly describeEngine: BoardReadFloor<Answer<"describeEngine">>
  readonly listDefinitions: BoardReadFloor<Answer<"listDefinitions">>
  readonly countInstances: BoardReadFloor<Answer<"countInstances">>
  readonly searchInstances: BoardReadFloor<Answer<"searchInstances">>
  readonly getElementStatistics: BoardReadFloor<Answer<"getElementStatistics">>
  readonly searchIncidents: BoardReadFloor<Answer<"searchIncidents">>
}

/** `read` made now and kept nowhere, so there is nothing to release. */
export function unheld<T>(read: () => Promise<T>): HeldRead<T> {
  // Async, so even a synchronous failure reaches the caller as a rejection.
  return { read: (async () => read())(), release: () => undefined }
}

/** A read made now, kept nowhere. */
function readNow<T>(
  _engine: RuntimeEngine,
  _args: readonly unknown[],
  read: () => Promise<T>,
): HeldRead<FlooredAnswer<T>> {
  const at = Date.now()
  return unheld(async () => ({ value: await read(), at }))
}

/** The reads of a build made now, every one of them (`buildBoardData`). */
export const NO_FLOORS: BoardReadFloors = {
  describeEngine: readNow,
  listDefinitions: readNow,
  countInstances: readNow,
  searchInstances: readNow,
  getElementStatistics: readNow,
  searchIncidents: readNow,
}

function boardReadFloor<T>(keep: (value: T) => boolean = () => true): BoardReadFloor<T> {
  const cached = createHeldCache<FlooredAnswer<T>>({
    maxEntries: BOARD_READ_ENTRIES,
    ttlMs: BOARD_FLOOR_MS,
    now: () => Date.now(),
    keep: ({ value }) => keep(value),
  })
  return (engine, args, read) =>
    cached(runtimeEngineKey(engine), JSON.stringify(args), async () => {
      const at = Date.now()
      return { value: await read(), at }
    })
}

/** The floor of each read a board's build keeps (`cachedBoardData`). */
export const BOARD_READ_FLOORS: BoardReadFloors = {
  describeEngine: boardReadFloor(),
  listDefinitions: boardReadFloor(),
  countInstances: boardReadFloor((count) => count.atLeast !== true),
  searchInstances: boardReadFloor(),
  getElementStatistics: boardReadFloor(),
  searchIncidents: boardReadFloor(),
}
