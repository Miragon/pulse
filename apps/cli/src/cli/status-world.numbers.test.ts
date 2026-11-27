/**
 * The same numbers on every surface, the CLI's half of the status world: c7-core's recorded status
 * engines (`C7_STATUS_ENGINE`, the status world on Operaton 2.1.5 at history level FULL and at
 * NONE: a copy of a called instance's root incident at a call activity, a multi-instance body's
 * root incident, a batch's incident outside any process) served on loopback by the transport's
 * recorded engine and read by `pulse status`, end to end on a fake runtime whose clock stands at
 * the recording's instant, over the CLI's own wire. It asks only what the recording answers and
 * prints exactly what the recording expects of it, the JSON `engine_status`, the web app's verdict
 * feed and the chat overview's health feed are held to beside it in the engine connector
 * (engine-status.numbers.test.ts, verdict-data.numbers.test.ts, health-data.numbers.test.ts), and
 * c7-core holds all four to each other (src/testing/status-engine.test.ts).
 *
 * With RECORD_STATUS_WORLD=1 (`record:status-world` of this package, the CLI's half of
 * `pnpm record:status-world`), it writes what it printed into the recording instead, over the
 * answers the server's half just wrote there.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  C7_STATUS_ENGINE,
  type C7RecordedStatusEngine,
  type C7StatusEngine,
} from "@miragon/pulse-c7-core/testing"
import { startRecordedEngine } from "@miragon/pulse-http/testing/loopback"
import { execute, fakeRuntime } from "../../test/support/fake-runtime.js"
import { withoutPorts } from "../../test/support/loopback-engine.js"
import { run } from "./run.js"

const RECORDING = new URL(
  "../../../../packages/connectors/c7/c7-core/src/testing/status-engine.json",
  import.meta.url,
)
const RECORDING_RUN = process.env.RECORD_STATUS_WORLD === "1"
if (RECORDING_RUN && process.env.CI) {
  throw new Error("RECORD_STATUS_WORLD is forbidden in CI: the recording changes only by a diff.")
}

/** The recording: the one the server's half just wrote when recording, else c7-core's. */
const recorded: C7StatusEngine = RECORDING_RUN
  ? (JSON.parse(readFileSync(RECORDING, "utf8")) as C7StatusEngine)
  : C7_STATUS_ENGINE

/** What `pulse status` prints over `engine`'s answers at the recording's instant, and what it missed. */
async function pulseStatus(engine: C7RecordedStatusEngine) {
  const served = await startRecordedEngine(engine.answers)
  try {
    const runtime = fakeRuntime({
      env: { PULSE_CLI_URL: `${served.origin}/engine-rest` },
      fetch: globalThis.fetch,
      now: () => Date.parse(recorded.asOf),
    })
    const outcome = await execute(run, ["status"], runtime)
    expect(outcome.stderr, outcome.stderr).toBe("")
    expect(outcome.code).toBe(0)
    return {
      printed: withoutPorts(JSON.parse(outcome.stdout) as unknown),
      unanswered: served.unanswered.map(({ method, target }) => `${method} ${target}`),
    }
  } finally {
    await served.close()
  }
}

beforeAll(() => {
  vi.stubEnv("TZ", "UTC")
})

afterAll(() => {
  if (RECORDING_RUN) writeFileSync(RECORDING, `${JSON.stringify(recorded, undefined, 2)}\n`)
  vi.unstubAllEnvs()
})

describe("pulse status over c7-core's recorded status engines", () => {
  it("holds the engine at history level full and the one at none", () => {
    expect(recorded.engines.map(({ engine }) => engine)).toEqual(["full", "none"])
  })

  describe.each(recorded.engines.map((engine) => [engine.engine, engine] as const))(
    "the engine at history level %s",
    (_name, engine) => {
      it("asks only what the engine answered and prints what the recording expects", async () => {
        const { printed, unanswered } = await pulseStatus(engine)
        expect(unanswered).toEqual([])
        if (RECORDING_RUN) {
          ;(engine.expected as { cliStatus: unknown }).cliStatus = printed
          return
        }
        expect(printed).toEqual(engine.expected.cliStatus)
      })
    },
  )
})
