/**
 * The same numbers on both C7 wires over the status world's screens, the MCP server's half:
 * c7-core's `C7_STATUS_SCREENS` (the status world on Operaton 2.1.5 at history level FULL, which
 * the conformance world's recordings cannot hold, Camunda 8 having no multi-instance body) served on
 * loopback by the transport's recorded engine, read through the process screen's, the instance
 * screen's and the board's feeds over the server's SDK wire at the recording's instant. They ask
 * only what the recording answers and give exactly the process screen of pulse-status-approval, the
 * instance screen of APR-139-2 and the board with a diagram of that process the recording expects,
 * the ones the C7 adapter builds from the same answers (its test/c7-status-screens-numbers.test.ts):
 * the multi-instance body's root incident on the element it repeats, beside the items waiting
 * there (c7-core's src/testing/status-screens.test.ts holds the recording to that).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { C7_STATUS_SCREENS } from "@miragon/pulse-c7-core/testing"
import { type RecordedEngine, startRecordedEngine } from "@miragon/pulse-http/testing/loopback"
import type { InstanceScreenData } from "@miragon/pulse-screens"
import { readStatusScreens } from "../../lib/core-adapter/status-screens.test-support.js"

const served: RecordedEngine[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse(C7_STATUS_SCREENS.asOf) })
})

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(served.splice(0).map((engine) => engine.close()))
})

/** What the feeds give over the recorded answers, and what they asked unanswered. */
async function readRecordedScreens() {
  const engine = await startRecordedEngine(C7_STATUS_SCREENS.answers)
  served.push(engine)
  const { instance } = C7_STATUS_SCREENS.expected as { readonly instance: InstanceScreenData }
  const given = await readStatusScreens(
    { engine: C7_STATUS_SCREENS.engine, url: `${engine.origin}/engine-rest`, flavor: "operaton" },
    C7_STATUS_SCREENS.text,
    instance.instance.id,
  )
  return { given, unanswered: engine.unanswered }
}

describe("the screen and board feeds over c7-core's recorded status screens, over the SDK wire", () => {
  it.each(["process", "instance", "board"] as const)(
    "ask the engine only what it answered and give the %s the recording expects",
    async (name) => {
      const { given, unanswered } = await readRecordedScreens()
      expect(unanswered).toEqual([])
      expect(given[name]).toEqual(C7_STATUS_SCREENS.expected[name])
    },
  )
})
