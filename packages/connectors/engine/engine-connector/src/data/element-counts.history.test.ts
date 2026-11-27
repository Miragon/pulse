import { afterEach, describe, expect, it, vi } from "vitest"
import { registerProcessNumberTools } from "../tools/process-numbers.js"
import {
  callTool,
  captureTools,
  registryFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import {
  NOW,
  statsWorld,
  V1 as STATS_V1,
  V2 as STATS_V2,
} from "../tools/test-support/stats-world.js"
import {
  build,
  closeEngines,
  HISTORY,
  KEY,
  statisticsReads,
  V1,
  V2,
} from "./activity-throughput.test-support.js"
import type { ProcessStatsData } from "./process-stats-data.js"

// F27 (#691): only the runtime's element counts skip a version the engine-wide statistics name
// idle (`readElementCounts`). What the history counts is not zero for a version with nothing
// running, so no history read asks the statistics which versions hold something.

const engines: FakeEngine[] = []
afterEach(async () => {
  vi.useRealTimers()
  await closeEngines()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The engine-wide statistics: `idle` with nothing running, no job without retries, no incident. */
const statisticsNaming = (key: string, held: string, idle: string): FakeReply => ({
  body: [
    { id: held, instances: 1, definition: { id: held, key, version: 2 } },
    { id: idle, instances: 0, definition: { id: idle, key, version: 1 } },
  ],
})

describe("a history read of a version with nothing running", () => {
  it("Throughput reads and counts what v1's instances passed, though nothing runs on it", async () => {
    const { data, engine } = await build(
      {},
      {
        "GET /process-definition/statistics": statisticsNaming(KEY, V2, V1),
      },
    )

    expect(
      statisticsReads(engine)
        .map((r) => r.path)
        .sort(),
    ).toEqual([
      `/history/process-definition/${V1}/statistics`,
      `/history/process-definition/${V2}/statistics`,
    ])
    expect(engine.requests.some((r) => r.path === "/process-definition/statistics")).toBe(false)
    // v1's element only it has: passed twice in the window, nothing running there.
    expect(HISTORY[V1]).toContainEqual(expect.objectContaining({ id: "legacyCheck" }))
    expect(data.activities).toContainEqual(
      expect.objectContaining({ activityId: "legacyCheck", passed: 2, running: 0 }),
    )
  })

  it("engine_process_stats counts the instances that ended on v1, though nothing runs on it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const world = statsWorld()
    const engine = await startFakeEngine({}, (request: RecordedRequest) =>
      request.path === "/process-definition/statistics"
        ? statisticsNaming("order", STATS_V2, STATS_V1)
        : world(request),
    )
    engines.push(engine)
    const config = captureTools(registerProcessNumberTools).get("engine_process_stats")
    if (config === undefined) throw new Error("engine_process_stats is not registered")

    const data = (await callTool(config, registryFor(engine), {
      processDefinitionKey: "order",
      bucket: "day",
    })) as ProcessStatsData

    // The world's instance `c` ended on v1 at its end event `rejected`, on 2026-11-20.
    const day = data.buckets.findIndex((bucket) => bucket.start === "2026-11-20T00:00:00.000Z")
    expect(data.buckets[day]?.endedAt.rejected).toBe(1)
    const endedCounts = engine.requests.filter(
      (r) =>
        r.path === "/history/process-instance/count" && r.query.processDefinitionId === STATS_V1,
    )
    expect(endedCounts.length).toBeGreaterThan(0)
  })
})
