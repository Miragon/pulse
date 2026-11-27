/**
 * The seven reads a board's numbers take (`BoardReads` of @miragon/pulse-board/builder), over the
 * engine contract's runtime of one engine a call resolved, of any dialect the server reads
 * (`resolveRuntimeEngine`, `runtimeOf`, invariant 2): the board builder reads them, the same
 * builder the editors run, so a board shows the same numbers on every surface. Six of them go
 * through the board's floor per engine, caller, read and arguments (`board-floor.ts`) when the
 * build keeps them, the diagram's XML through the one XML cache (`diagramXmlOf`, kept for good per
 * engine and caller). The builder turns a failed read, or one its deadline per engine cut, into a
 * number left out; the log notes both, so a build that missed a read is never kept
 * (`board-data.ts`), and holds the reads still out, so the ones the deadline cut leave the floor
 * as the build ends (`leaveFloor`).
 */

import type { BoardReads } from "@miragon/pulse-board/builder"
import { diagramXmlOf } from "../lib/engine/diagram-xml.js"
import { runtimeOf } from "../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../lib/engine/resolve-engine.js"
import { cancellationOf } from "../lib/engine/runtime-errors.js"
import type { HeldRead } from "../lib/engine/per-engine.js"
import { type BoardReadFloor, type BoardReadFloors, NO_FLOORS, unheld } from "./board-floor.js"

/**
 * What the reads of one build met: whether one failed, the caller's cancellation if it came, on
 * either wire (`cancellationOf`), the reads still out (one the builder's deadline cut stays out
 * after the build) and when the oldest answer it took from the floor was read.
 */
export interface ReadLog {
  failed: boolean
  cancelled?: Error
  readonly out: Set<HeldRead<unknown>>
  oldest?: number
}

/** A log of a build that has read nothing yet. */
export const newReadLog = (): ReadLog => ({ failed: false, out: new Set() })

/**
 * The read `start` begins, its failure noted in `log` (one that throws as it starts included) and
 * passed on to the builder, in `log.out` while it is out.
 */
async function logged<T>(log: ReadLog, start: () => HeldRead<T>): Promise<T> {
  let held: HeldRead<T> | undefined
  try {
    held = start()
    log.out.add(held)
    return await held.read
  } catch (error) {
    log.failed = true
    log.cancelled ??= cancellationOf(error)
    throw error
  } finally {
    if (held !== undefined) log.out.delete(held)
  }
}

/**
 * Takes each read still out off its floor, once the build ended: the builder's deadline cut it,
 * whether or not its transport is aborted, so the next build asks its engine anew instead of
 * waiting on it and a late answer is kept nowhere. A build that overlapped it still shares it.
 */
export function leaveFloor(log: ReadLog): void {
  for (const held of log.out) held.release()
}

/**
 * The board reads of `engine`, each failure noted in `log`, each read but the diagram's XML
 * through `floors`: the board's floor, or none for a build made now.
 */
export function boardReadsOf(
  engine: RuntimeEngine,
  log: ReadLog,
  floors: BoardReadFloors = NO_FLOORS,
): BoardReads {
  const runtime = runtimeOf(engine)
  const floored = async <T>(
    floor: BoardReadFloor<T>,
    args: readonly unknown[],
    read: () => Promise<T>,
  ) => {
    const { value, at } = await logged(log, () => floor(engine, args, read))
    log.oldest = Math.min(at, log.oldest ?? at)
    return value
  }
  return {
    describeEngine: () => floored(floors.describeEngine, [], () => runtime.describeEngine()),
    listDefinitions: () => floored(floors.listDefinitions, [], () => runtime.listDefinitions()),
    countInstances: (filter) =>
      floored(floors.countInstances, [filter], () => runtime.countInstances(filter)),
    searchInstances: (filter, page) =>
      floored(floors.searchInstances, [filter, page], () => runtime.searchInstances(filter, page)),
    getDiagramXml: (definitionId) =>
      logged(log, () =>
        unheld(async () => (await diagramXmlOf(engine, definitionId)) ?? undefined),
      ),
    getElementStatistics: (definitionId) =>
      floored(floors.getElementStatistics, [definitionId], () =>
        runtime.getElementStatistics(definitionId),
      ),
    searchIncidents: (filter, page) =>
      floored(floors.searchIncidents, [filter, page], () => runtime.searchIncidents(filter, page)),
  }
}

/**
 * The reads of an engine whose profile the server refused: the builder asks only what the engine
 * is, and the refusal answers, so the board shows the engine failed with it and reads nothing.
 */
export function refusedReads(refusal: Error): BoardReads {
  const refuse = () => Promise.reject(refusal)
  return {
    describeEngine: refuse,
    listDefinitions: refuse,
    countInstances: refuse,
    searchInstances: refuse,
    getDiagramXml: refuse,
    getElementStatistics: refuse,
    searchIncidents: refuse,
  }
}
