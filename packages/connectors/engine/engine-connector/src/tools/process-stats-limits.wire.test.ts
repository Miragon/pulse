import { afterEach, describe, expect, it, vi } from "vitest"
import { registerProcessNumberTools } from "./process-numbers.js"
import {
  callTool,
  captureTools,
  registryFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
} from "./test-support/fake-engine.js"
import { INSTANCES, NOW, statsWorld, V2 } from "./test-support/stats-world.js"
import type { ProcessStatsData } from "../data/process-stats-data.js"
import { fetchStatsByKey } from "../data/definition-info.js"
import { resolveEngine } from "../lib/engine/resolve-engine.js"

/**
 * `engine_process_stats` on the wire where its reads meet an engine's limits: no history written,
 * a zone named in any spelling, a bare date, a long tail of versions and the database's sorted
 * reads, against the fake engine of `test-support/stats-world.ts`.
 */

const tools = captureTools(registerProcessNumberTools)

const engines: FakeEngine[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function call(answer: (request: RecordedRequest) => FakeReply, name: string, args: object) {
  const engine = await startFakeEngine({}, answer)
  engines.push(engine)
  const config = tools.get(name)
  if (!config) throw new Error(`${name} is not registered`)
  const result = await callTool(config, registryFor(engine), args as Record<string, unknown>)
  return { data: result as ProcessStatsData, requests: engine.requests }
}

describe("engine_process_stats at an engine's limits", () => {
  it("says every history count is unknown where the engine writes no history", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    // History level none: instances run, the history holds none of them, every count answers 0.
    const { data, requests } = await call(statsWorld({ instances: [] }), "engine_process_stats", {
      processDefinitionKey: "order",
      bucket: "day",
    })
    expect(data.history.recorded).toBe(false)
    expect(data.now).toMatchObject({ running: 4, startedLast24h: null, endedLast24h: null })
    expect(data.totals).toEqual({ started: null, ended: null })
    expect(new Set(data.buckets.flatMap((bucket) => [bucket.started, bucket.ended]))).toEqual(
      new Set([null]),
    )
    expect(data.endEvents.map((event) => [event.activityId, event.ended, event.durations])).toEqual(
      [
        ["shipped", null, null],
        ["notified", null, null],
      ],
    )
    expect(data.durations).toBeNull()
    expect(requests.some((r) => r.query.sortBy === "duration")).toBe(false)
  })

  it("reads a bare date as that day in the zone, so the range is the zone's whole days", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const { data } = await call(statsWorld(), "engine_process_stats", {
      processDefinitionKey: "order",
      bucket: "day",
      timeZone: "Europe/Berlin",
      from: "2026-11-20",
      to: "2026-11-23",
    })
    expect(data.range).toMatchObject({
      from: "2026-11-19T23:00:00.000Z",
      to: "2026-11-22T23:00:00.000Z",
    })
    expect(data.buckets.map((bucket) => [bucket.start, bucket.end])).toEqual([
      ["2026-11-19T23:00:00.000Z", "2026-11-20T23:00:00.000Z"],
      ["2026-11-20T23:00:00.000Z", "2026-11-21T23:00:00.000Z"],
      ["2026-11-21T23:00:00.000Z", "2026-11-22T23:00:00.000Z"],
    ])
  })

  it("names the zone as the runtime spells it, whatever the caller's spelling", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const { data } = await call(statsWorld(), "engine_process_stats", {
      processDefinitionKey: "order",
      bucket: "day",
      timeZone: "eUrOpE/bErLiN",
    })
    expect(data.range.timeZone).toBe("Europe/Berlin")
  })

  it("counts the newest versions only, and ranks durations one read at a time", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    // 30 versions, none of which holds the instances that ended: a deployment deleted without
    // its history left them under the key.
    // The newest one has v2's diagram, whose two end events each rank their durations too.
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: i === 0 ? V2 : `order:${String(30 - i)}:x${String(i)}`,
      key: "order",
      name: null,
      version: 30 - i,
      historyTimeToLive: null,
    }))
    const orphans = INSTANCES.map((row) => ({ ...row, definitionId: "order:0:deleted" }))
    const world = statsWorld({ instances: orphans, versions: many })
    let open = 0
    let most = 0
    const answer = async (request: RecordedRequest): Promise<FakeReply> => {
      if (request.query.sortBy !== "duration") return world(request)
      open += 1
      most = Math.max(most, open)
      await new Promise((resolve) => setTimeout(resolve, 5))
      open -= 1
      return world(request)
    }
    const engine = await startFakeEngine({}, answer)
    engines.push(engine)
    const config = tools.get("engine_process_stats")
    if (!config) throw new Error("engine_process_stats is not registered")
    await callTool(config, registryFor(engine), { processDefinitionKey: "order", bucket: "day" })
    const cohorts = engine.requests.filter((r) => r.query.processDefinitionId !== undefined)
    expect(cohorts).toHaveLength(12)
    expect(cohorts.map((r) => r.query.processDefinitionId)).toEqual(
      many.slice(0, 12).map((v) => v.id),
    )
    // The median and P90 overall and of "shipped", one row of "notified" (one ended there):
    // five rows, never two at once.
    expect(engine.requests.filter((r) => r.query.sortBy === "duration")).toHaveLength(5)
    expect(most).toBe(1)
  })

  it("names the statistics read it counts the incidents from, as of when it was sent", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW - 10_000 })
    const engine = await startFakeEngine({}, statsWorld({ instances: INSTANCES }))
    engines.push(engine)
    const registry = registryFor(engine)
    // Another view of the caller's read the statistics 10 s before: the call counts that read.
    await fetchStatsByKey(resolveEngine("fake", registry).client)
    vi.setSystemTime(NOW)
    const config = tools.get("engine_process_stats")
    if (!config) throw new Error("engine_process_stats is not registered")
    const args = { processDefinitionKey: "order", bucket: "day" }
    const data = (await callTool(config, registry, args)) as ProcessStatsData
    expect(data.asOf).toBe(new Date(NOW - 10_000).toISOString())
    const statistics = engine.requests.filter((r) => r.path === "/process-definition/statistics")
    expect(statistics).toHaveLength(1)
  })
})
