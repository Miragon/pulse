import { afterAll, beforeAll, describe, it, vi } from "vitest"
import { bootServer, type BootedServer } from "../boot-server.js"
import { assertGolden } from "../golden.js"
import { startEngine, withoutPorts, type LoopbackEngine } from "./fake-engines.js"
import { modelResult, NOW, OUTPUT_DIR, sentLines } from "./goldens.js"
import { worldAnswer } from "./world.js"

/**
 * Output goldens (W0): what the model reads from the three engine reads the CLI has twins of
 * (`pulse status`, `pulse inspect`), byte for byte: the content text (as `textLines`) and the
 * structuredContent of each result, and the requests the engine saw. One boot of the real app
 * (`createApp`) with two engine profiles in two environments, one of them the loopback world
 * (world.ts), under a fixed clock and in UTC. The golden file sorts every object's keys, so the
 * structuredContent is pinned by its values, the content text byte for byte. Intended change:
 * `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update`, then commit the
 * JSON diff (refused in CI).
 */

const CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["engine_list_engines", {}],
  ["engine_status", {}],
  [
    "engine_inspect_process_instance",
    { processInstanceId: "pi-1", includeVariables: true, includeStacktraces: true },
  ],
]

let engine: LoopbackEngine
let server: BootedServer

beforeAll(async () => {
  for (const level of ["info", "warn", "log"] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  // No golden reads the local time today; one that starts to stays the same on every machine.
  vi.stubEnv("TZ", "UTC")
  engine = await startEngine(worldAnswer)
  server = await bootServer({
    env: {
      ENGINES_JSON: JSON.stringify({
        profiles: {
          "prod-eu": {
            url: `${engine.origin}/engine-rest`,
            cockpitUrl: "https://ops.example.com/camunda/app/cockpit/default/",
            flavor: "cibseven",
            environment: "prod",
          },
          test: { url: "http://localhost:1/engine-rest", flavor: "operaton", environment: "test" },
        },
      }),
      ENGINE_DEFAULT: "prod-eu",
    },
  })
})

afterAll(async () => {
  await server.close()
  await engine.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("the model-facing results of the engine reads", () => {
  it.each(CALLS)("%s", async (tool, args) => {
    // Nothing fails here, so no read is cancelled: the engine answers each at once.
    engine.begin(0)
    const result = await server.client.callTool({ name: tool, arguments: args })
    const golden = {
      tool,
      arguments: args,
      result: modelResult(result),
      sent: sentLines(engine.requests),
    }
    assertGolden(tool, withoutPorts(golden), OUTPUT_DIR)
  })
})
