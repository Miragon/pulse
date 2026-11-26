import { afterAll, beforeAll, describe, it, vi } from "vitest"
import { bootServer, type BootedServer } from "../boot-server.js"
import { assertGolden } from "../golden.js"
import { startEngine, withoutPorts, type LoopbackEngine } from "./fake-engines.js"
import { modelResult, NOW, OUTPUT_DIR, sentLines } from "./goldens.js"
import { processNumbersAnswer } from "./process-numbers-world.js"

/**
 * Output goldens of a process's numbers (#665): what the model, and a page that draws them, reads
 * from `engine_process_stats` and `engine_activity_counts`, byte for byte, and every request the
 * engine saw, against the loopback world of process-numbers-world.ts under the goldens' fixed clock
 * and in UTC, through the real app (`createApp`). Intended change:
 * `pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update`.
 */

const CALLS: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ["engine_process_stats", { processDefinitionKey: "order", bucket: "day" }],
  ["engine_activity_counts", { processDefinitionKey: "order" }],
]

let engine: LoopbackEngine
let server: BootedServer

beforeAll(async () => {
  for (const level of ["info", "warn", "log"] as const) {
    vi.spyOn(console, level).mockImplementation(() => {})
  }
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  vi.stubEnv("TZ", "UTC")
  engine = await startEngine(processNumbersAnswer)
  server = await bootServer({
    env: {
      ENGINES_JSON: JSON.stringify({
        profiles: { "prod-eu": { url: `${engine.origin}/engine-rest`, flavor: "cibseven" } },
      }),
    },
  })
})

afterAll(async () => {
  await server.close()
  await engine.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("the model-facing results of a process's numbers", () => {
  it.each(CALLS)("%s", async (tool, args) => {
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
