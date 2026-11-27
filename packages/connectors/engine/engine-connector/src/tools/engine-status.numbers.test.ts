/**
 * The same numbers on every surface, `engine_status`'s half of the status world: c7-core's recorded
 * status engines (`C7_STATUS_ENGINE`, the status world on Operaton 2.1.5 at history level FULL and
 * at NONE: a copy of a called instance's root incident at a call activity, a multi-instance body's
 * root incident, a batch's incident outside any process) served on loopback, read by the tool
 * over the server's SDK wire at the recording's instant. It asks only what the recording answers
 * and gives exactly the JSON the recording expects of it, and the status it expects at the two
 * thresholds on the world's edge (critical from the root incidents it counts, then from one more),
 * beside which the CLI prints its
 * `pulse status` (apps/cli/src/cli/status-world.numbers.test.ts) and the verdict and health feeds
 * give theirs (verdict-data.numbers.test.ts, health-data.numbers.test.ts); c7-core holds the four
 * to each other (src/testing/status-engine.test.ts).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  atRecordedInstant,
  closeRecordedStatus,
  edgesOf,
  RECORDED_STATUS_ENGINES,
  readRecorded,
} from "../data/recorded-status.test-support.js"
import { statusOf } from "../lib/core-adapter/status-surfaces.test-support.js"

beforeEach(atRecordedInstant)
afterEach(closeRecordedStatus)

describe.each(RECORDED_STATUS_ENGINES)(
  "engine_status over c7-core's recorded status engine at history level %s",
  (_name, recorded) => {
    it("asks only what the engine answered and gives the JSON the recording expects", async () => {
      const { given, unanswered } = await readRecorded(recorded, "engineStatus")
      expect(unanswered).toEqual([])
      expect(given).toEqual(recorded.expected.engineStatus)
    })

    it.each(edgesOf(recorded))(
      "judges as the recording expects, critical from %i root incidents on the world's edge",
      async (criticalIncidents, edge) => {
        const { given, unanswered } = await readRecorded(
          recorded,
          "engineStatus",
          criticalIncidents,
        )
        expect(unanswered).toEqual([])
        expect(statusOf(given)).toBe(edge.engineStatus)
      },
    )
  },
)
