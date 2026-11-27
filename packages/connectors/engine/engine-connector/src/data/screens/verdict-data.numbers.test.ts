/**
 * The same numbers on every surface, the web app's verdict feed's half of the status world:
 * c7-core's recorded status engines (`C7_STATUS_ENGINE`, the status world on Operaton 2.1.5 at
 * history level FULL and at NONE) served on loopback, read by `engine_screen_verdict_data` over
 * the server's SDK wire at the recording's instant. It asks only what the recording answers and
 * gives exactly the verdict and the count outside any process the recording expects, which
 * engine_status, the CLI's status and the overview's health judge alike, by the default
 * thresholds and at the two on the world's edge (critical from the root incidents engine_status
 * counts, then from one more), where a root incident of a process or outside any counted once too
 * often or not at all turns the verdict
 * (engine-status.numbers.test.ts, health-data.numbers.test.ts, the CLI's
 * status-world.numbers.test.ts; c7-core's src/testing/status-engine.test.ts holds them together).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  atRecordedInstant,
  closeRecordedStatus,
  edgesOf,
  RECORDED_STATUS_ENGINES,
  readRecorded,
} from "../recorded-status.test-support.js"

beforeEach(atRecordedInstant)
afterEach(closeRecordedStatus)

describe.each(RECORDED_STATUS_ENGINES)(
  "the verdict feed over c7-core's recorded status engine at history level %s",
  (_name, recorded) => {
    it("asks only what the engine answered and gives the verdict the recording expects", async () => {
      const { given, unanswered } = await readRecorded(recorded, "verdict")
      expect(unanswered).toEqual([])
      expect(given).toEqual(recorded.expected.verdict)
    })

    it.each(edgesOf(recorded))(
      "judges as the recording expects, critical from %i root incidents on the world's edge",
      async (criticalIncidents, edge) => {
        const { given, unanswered } = await readRecorded(recorded, "verdict", criticalIncidents)
        expect(unanswered).toEqual([])
        expect(given).toEqual(edge.verdict)
      },
    )
  },
)
