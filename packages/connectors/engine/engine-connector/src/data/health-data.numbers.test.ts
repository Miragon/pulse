/**
 * The same numbers on every surface, the chat overview's health feed's half of the status world:
 * c7-core's recorded status engines (`C7_STATUS_ENGINE`, the status world on Operaton 2.1.5 at
 * history level FULL and at NONE) served on loopback, read by `engine_health_data` over the
 * server's SDK wire at the recording's instant. It asks only what the recording answers and gives
 * exactly the verdict, the summary (the processes' open root incidents, their last hour and their
 * affected activities, the count outside any process, the day's instances where the engine writes
 * history) and the processes' causes the recording expects, and its verdict at the two thresholds
 * on the world's edge (critical from the root incidents engine_status counts, then from one more),
 * beside engine_status, the CLI's status and the verdict feed (engine-status.numbers.test.ts,
 * verdict-data.numbers.test.ts, the CLI's status-world.numbers.test.ts; c7-core's
 * src/testing/status-engine.test.ts holds them together).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  atRecordedInstant,
  closeRecordedStatus,
  edgesOf,
  RECORDED_STATUS_ENGINES,
  readRecorded,
} from "./recorded-status.test-support.js"
import { statusOf } from "../lib/core-adapter/status-surfaces.test-support.js"

beforeEach(atRecordedInstant)
afterEach(closeRecordedStatus)

describe.each(RECORDED_STATUS_ENGINES)(
  "the health feed over c7-core's recorded status engine at history level %s",
  (_name, recorded) => {
    it("asks only what the engine answered and gives the health the recording expects", async () => {
      const { given, unanswered } = await readRecorded(recorded, "health")
      expect(unanswered).toEqual([])
      expect(given).toEqual(recorded.expected.health)
    })

    it.each(edgesOf(recorded))(
      "judges as the recording expects, critical from %i root incidents on the world's edge",
      async (criticalIncidents, edge) => {
        const { given, unanswered } = await readRecorded(recorded, "health", criticalIncidents)
        expect(unanswered).toEqual([])
        expect(statusOf(given)).toBe(edge.health)
      },
    )
  },
)
