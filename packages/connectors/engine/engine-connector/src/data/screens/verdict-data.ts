/**
 * A Camunda 7 engine's live verdict for the web app's engine screen and start page (D10, plan PR
 * 21): c7-core's one verdict (`engineVerdict`) over the engine's open root incidents
 * (`rootIncidentCounts`), by the deployment's thresholds (`ENGINE_HEALTH_*`), as the cockpit's
 * overview and `engine_status` decide it. The page reads it and never decides one itself; a Camunda
 * 8 engine has none (the feed serves Camunda 7 alone, as the server decides no verdict for Camunda
 * 8). Its two reads, neither of them a second statistics read:
 *
 * - the root incidents of the processes are the engine screen's (its list of processes,
 *   `readEngineProcesses`, their incidents summed: the one definition statistics read with
 *   `rootIncidents=true`), on that list's floor, so the page's screen and its verdict share one
 *   read of it, whether both ask at once or the verdict after the screen, and whatever the screen
 *   read of what the engine is;
 * - the newest open incidents are the cockpit overview's scan (`scanOpenIncidents`), whose root
 *   incidents give those outside any process and the largest cause, lower bounds where it stops.
 *
 * Beside the verdict it answers the root incidents outside any process it judged (a batch's or the
 * history cleanup's failed job, which no process row counts), so the page shows them as a line of
 * their own without a read of its own (owner decision of 2026-11-26, `scanVerdict`).
 *
 * The verdict stands on a floor of 30 s per caller of its own (`screen-floor.ts`), so a page's
 * Refresh within it reads nothing again. A failed read fails the feed, and the page shows the
 * verdict's failure beside the figures it read apart.
 */

import type { VerdictThresholds } from "@miragon/pulse-c7-core"
import type { ResolvedEngine } from "../../lib/engine/resolve-engine.js"
import { scanOpenIncidents } from "../cluster-scan.js"
import { type ScanVerdict, scanVerdict } from "../scan-verdict.js"
import { readEngineProcesses } from "./engine-screen-data.js"
import { screenFloor } from "./screen-floor.js"

/**
 * The verdict feed's answer: the engine's live verdict, `ok`, `warning` or `critical`, and the root
 * incidents outside any process it judged, `atLeast` where the scan stops.
 */
export type EngineVerdictData = ScanVerdict

const verdictFloor = screenFloor<EngineVerdictData>()

/** The verdict of `engine` (a Camunda 7 engine): one read in the floor's 30 s, else read now. */
export function buildEngineVerdictData(
  engine: ResolvedEngine,
  thresholds: VerdictThresholds,
): Promise<EngineVerdictData> {
  return verdictFloor(engine, {}, async () => {
    const [processes, incidents] = await Promise.all([
      readEngineProcesses(engine),
      scanOpenIncidents(engine.client),
    ])
    const ofProcesses = processes.definitions.reduce((sum, process) => sum + process.incidents, 0)
    return scanVerdict(ofProcesses, incidents, thresholds)
  })
}
