/**
 * Output goldens (W0) of the CLI: what `pulse status` and `pulse inspect` print, as JSON and as
 * tables, byte for byte, with the requests the engine saw, against the loopback world the MCP
 * server's output goldens read too (test/support/golden-world.ts) under a fixed clock and in UTC.
 * They pin today's behaviour before the transport moves (the plan's steps 11 and 14). Intended
 * change: `pnpm --fail-if-no-match --filter @miragon/pulse-cli golden:update`, then commit the
 * diff (refused in CI). The helper itself is tested in golden.test.ts.
 */

import { afterAll, beforeAll, describe, it, vi } from "vitest"
import { assertGolden, linesOf } from "../../../test/support/golden.js"
import { worldAnswer } from "../../../test/support/golden-world.js"
import { execute, fakeRuntime } from "../../../test/support/fake-runtime.js"
import {
  sentLines,
  startEngine,
  withoutPorts,
  type LoopbackEngine,
} from "../../../test/support/loopback-engine.js"
import { run } from "../run.js"

/** The clock of every golden, the MCP server's too: the status derives its overdue cut-off. */
const NOW = Date.parse("2026-10-09T14:00:00.000Z")

const COMMANDS: Readonly<Record<string, readonly string[]>> = {
  status: ["status"],
  "status-table": ["status", "-o", "table"],
  inspect: ["inspect", "pi-1", "--stacktrace"],
  "inspect-table": ["inspect", "pi-1", "--stacktrace", "-o", "table"],
}

let engine: LoopbackEngine

beforeAll(async () => {
  // No golden reads the local time today; one that starts to stays the same on every machine.
  vi.stubEnv("TZ", "UTC")
  engine = await startEngine(worldAnswer)
})

afterAll(async () => {
  await engine.close()
  vi.unstubAllEnvs()
})

describe("what the workflow commands print", () => {
  it.each(Object.entries(COMMANDS))("%s", async (name, argv) => {
    // Nothing fails here, so no read is cut short: the engine answers each at once.
    engine.begin(0)
    const runtime = fakeRuntime({
      env: { PULSE_CLI_URL: `${engine.origin}/engine-rest` },
      fetch: globalThis.fetch,
      now: () => NOW,
    })
    const outcome = await execute(run, argv, runtime)
    const golden = {
      argv,
      exitCode: outcome.code,
      stdoutLines: linesOf(outcome.stdout),
      stderrLines: linesOf(outcome.stderr),
      sent: sentLines(engine.requests),
    }
    assertGolden("outputs", name, withoutPorts(golden))
  })
})
