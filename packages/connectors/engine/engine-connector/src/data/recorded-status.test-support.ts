/**
 * The server over one of c7-core's recorded status engines (`C7_STATUS_ENGINE`: the status world
 * on Operaton 2.1.5 at history level FULL and at NONE), served on loopback by the transport's
 * recorded engine, with the clock at the recording's instant: what one of its surfaces gives,
 * read through the module's own tool (status-surfaces.test-support.ts) by the default thresholds or
 * at one on the world's edge, and the requests no recorded answer matched. Each surface's numbers
 * test holds it to what the recording expects of it.
 */

import { vi } from "vitest"
import { C7_STATUS_ENGINE, type C7RecordedStatusEngine } from "@miragon/pulse-c7-core/testing"
import { type RecordedEngine, startRecordedEngine } from "@miragon/pulse-http/testing/loopback"
import {
  type StatusSurface,
  statusServer,
} from "../lib/core-adapter/status-surfaces.test-support.js"

/** Each recorded engine by its name, for `describe.each`. */
export const RECORDED_STATUS_ENGINES = C7_STATUS_ENGINE.engines.map(
  (recorded) => [recorded.engine, recorded] as const,
)

const served: RecordedEngine[] = []

/** Holds the clock at the recording's instant, as the recording read: `beforeEach`. */
export function atRecordedInstant(): void {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse(C7_STATUS_ENGINE.asOf) })
}

/** Lets the clock run again and closes the engines served so far: `afterEach`. */
export async function closeRecordedStatus(): Promise<void> {
  vi.useRealTimers()
  await Promise.all(served.splice(0).map((engine) => engine.close()))
}

/**
 * What `surface` gives of `recorded`'s engine over its answers, by the default thresholds or
 * critical from `criticalIncidents` open root incidents, and what it asked unanswered.
 */
export async function readRecorded(
  recorded: C7RecordedStatusEngine,
  surface: StatusSurface,
  criticalIncidents?: number,
) {
  const engine = await startRecordedEngine(recorded.answers)
  served.push(engine)
  const url = `${engine.origin}/engine-rest`
  const server = statusServer([{ engine: recorded.engine, url }], "operaton", criticalIncidents)
  const given = await server.read(surface, recorded.engine)
  return { given, unanswered: engine.unanswered }
}

/** The recorded engine's thresholds on the world's edge, each with what it expects there. */
export const edgesOf = (recorded: C7RecordedStatusEngine) =>
  recorded.expected.atEdges.map((edge) => [edge.criticalIncidents, edge] as const)
