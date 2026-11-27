/**
 * The process definition searches a screen sent to c8-core's recorded screen engine, which the
 * process and instance screens' numbers tests hold: a screen reads the latest versions of the
 * processes its version calls by their ids, never every latest version of the cluster, although
 * the recording still answers that search for the engine screen's list of processes.
 */

import type { RecordedEngine } from "@miragon/pulse-http/testing/loopback"

/** The filters of the process definition searches a Camunda 8 cluster saw, in code unit order. */
export const definitionSearches = (engine: RecordedEngine): string[] =>
  engine.seen
    .filter(({ target }) => target === "/v2/process-definitions/search")
    .map(({ body }) => JSON.stringify((JSON.parse(body) as { filter: unknown }).filter))
    .sort()

/** The search for the latest version of pulse-label, the process pulse-dispatch calls, by its id. */
export const LATEST_LABEL = '{"processDefinitionId":{"$in":["pulse-label"]},"isLatestVersion":true}'
