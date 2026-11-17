/**
 * The seven reads a board's numbers take (`BoardReads` of @miragon/pulse-board/builder), over the
 * engine contract's runtime of one engine a call resolved, of any dialect the server reads
 * (`resolveRuntimeEngine`, `runtimeOf`, invariant 2): the board builder reads them, the same
 * builder the editors run, so a board shows the same numbers on every surface. The diagram's XML
 * goes through the one XML cache (`diagramXmlOf`, kept for good per engine and caller). The
 * builder turns a failed read into a number left out; the log notes it, so a build that missed a
 * read is never kept (`board-data.ts`).
 */

import type { BoardReads } from "@miragon/pulse-board/builder"
import { RuntimeError } from "@miragon/pulse-engine-core"
import { diagramXmlOf } from "../lib/engine/diagram-xml.js"
import { EngineRequestError } from "../lib/engine/engine-error.js"
import { runtimeOf } from "../lib/engine/engine-runtime.js"
import type { RuntimeEngine } from "../lib/engine/resolve-engine.js"

/** What the reads of one build met: whether one failed, and the caller's cancellation if it came. */
export interface ReadLog {
  failed: boolean
  cancelled?: EngineRequestError
}

/** The engine call behind a failure: the error itself, or the cause the runtime wrapped. */
function requestErrorOf(error: unknown): EngineRequestError | undefined {
  if (error instanceof EngineRequestError) return error
  return RuntimeError.is(error) && error.cause instanceof EngineRequestError
    ? error.cause
    : undefined
}

/** `read`, its failure noted in `log` and passed on to the builder. */
async function logged<T>(log: ReadLog, read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    log.failed = true
    const request = requestErrorOf(error)
    if (request?.kind === "cancelled") log.cancelled ??= request
    throw error
  }
}

/** The board reads of `engine`, each failure noted in `log`. */
export function boardReadsOf(engine: RuntimeEngine, log: ReadLog): BoardReads {
  const runtime = runtimeOf(engine)
  return {
    describeEngine: () => logged(log, () => runtime.describeEngine()),
    listDefinitions: () => logged(log, () => runtime.listDefinitions()),
    countInstances: (filter) => logged(log, () => runtime.countInstances(filter)),
    searchInstances: (filter, page) => logged(log, () => runtime.searchInstances(filter, page)),
    getDiagramXml: (definitionId) =>
      logged(log, async () => (await diagramXmlOf(engine, definitionId)) ?? undefined),
    getElementStatistics: (definitionId) =>
      logged(log, () => runtime.getElementStatistics(definitionId)),
    searchIncidents: (filter, page) => logged(log, () => runtime.searchIncidents(filter, page)),
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
