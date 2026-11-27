/**
 * The live verdict over the cockpit overview's incident scan, the chat's overview's and the web
 * app's verdict feed's alike: c7-core's `engineVerdict` over its `rootIncidentCounts`, the
 * processes' open root incidents from an exact read and, of the scan (`scanOpenIncidents`), those
 * outside any process and the largest cause. Beside the verdict it hands on the root incidents
 * outside any process (a batch's or the history cleanup's failed job, which no statistics row
 * counts), a lower bound where the scan stops (`scanCoverage`), which each surface shows as a line
 * of its own, never summed into the processes' count (owner decision of 2026-11-26).
 */

import {
  type EngineStatus,
  engineVerdict,
  type OutsideAnyProcess,
  rootIncidentCounts,
  type VerdictThresholds,
} from "@miragon/pulse-c7-core"
import { type IncidentLike, scanCoverage } from "./cluster-scan.js"

/** The verdict and the root incidents outside any process it judged. */
export interface ScanVerdict {
  readonly status: EngineStatus
  readonly outsideAnyProcess: OutsideAnyProcess
}

/**
 * The verdict over `ofProcesses` (the processes' open root incidents, the definition statistics
 * with `rootIncidents=true`) and the overview's `scan`, by `thresholds`.
 */
export function scanVerdict(
  ofProcesses: number,
  scan: IncidentLike[],
  thresholds: VerdictThresholds,
): ScanVerdict {
  const counts = rootIncidentCounts(ofProcesses, {
    items: scan,
    truncated: !scanCoverage(scan).complete,
  })
  return { status: engineVerdict(counts, thresholds), outsideAnyProcess: counts.outsideAnyProcess }
}
