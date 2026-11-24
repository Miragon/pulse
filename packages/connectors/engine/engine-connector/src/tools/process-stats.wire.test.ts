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
import {
  at,
  DAY,
  HOUR,
  type Instance,
  MINUTE,
  NOW,
  statsWorld,
  V1,
  V2,
} from "./test-support/stats-world.js"
import { DURATION_RANK_LIMIT, type ProcessStatsData } from "../data/process-stats-data.js"

/**
 * `engine_process_stats` on the wire: what it asks the engine and what it makes of its answers,
 * against the fake engine of `test-support/stats-world.ts`.
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

const dayOf = (data: { buckets: Array<{ start: string }> }, iso: string) =>
  data.buckets.findIndex((bucket) => bucket.start === iso)

describe("engine_process_stats", () => {
  it("counts the last 14 UTC days per bucket, every series by the engine's count", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const { data, requests } = await call(statsWorld(), "engine_process_stats", {
      processDefinitionKey: "order",
      bucket: "day",
    })
    expect(data).toMatchObject({
      engine: "fake",
      processDefinitionKey: "order",
      processDefinitionName: "Order",
      asOf: "2026-11-24T12:00:00.000Z",
      versions: { count: 2, latestVersion: 2, latestDefinitionId: V2 },
      now: {
        running: 4,
        incidents: 2,
        withIncident: 1,
        failedJobs: 3,
        openTasks: 5,
        startedLast24h: 3,
        endedLast24h: 3,
      },
      range: {
        from: "2026-11-11T00:00:00.000Z",
        to: "2026-11-24T12:00:00.000Z",
        bucket: "day",
        timeZone: "UTC",
      },
      history: { timeToLiveDays: 30, keptFrom: "2026-10-25T12:00:00.000Z" },
      totals: { started: 5, ended: 5 },
    })
    expect(data.buckets).toHaveLength(14)
    // From the 11th: c on the 20th, b and d on the 23rd, a and f on the 24th.
    expect(data.buckets.map((bucket) => bucket.started)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 2, 2,
    ])
    // e on the 12th, c on the 20th, b (at midnight), a and f on the 24th.
    expect(data.buckets.map((bucket) => bucket.ended)).toEqual([
      0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 3,
    ])
    // The latest diagram's end events first, then the one only v1 has; none of a subprocess.
    expect(data.endEvents.map((event) => event.activityId)).toEqual([
      "shipped",
      "notified",
      "rejected",
    ])
    expect(data.endEvents[0]).toEqual({
      activityId: "shipped",
      name: "SHIPPED",
      ended: 4,
      // a 10 s, f 30 min, b 14 h, e 11 d 5 h: the 2nd and the 4th by rank.
      durations: {
        from: "2026-11-11T00:00:00.000Z",
        ended: 4,
        medianMs: 30 * MINUTE,
        p90Ms: 11 * DAY + 5 * HOUR,
      },
    })
    expect(data.buckets[dayOf(data, "2026-11-24T00:00:00.000Z")]?.endedAt).toEqual({
      shipped: 3,
      notified: 1,
      rejected: 0,
    })
    // 10 s, 30 min, 1 h, 14 h, 11 d 5 h: the 3rd and the 5th by rank.
    expect(data.durations).toEqual({
      from: "2026-11-11T00:00:00.000Z",
      ended: 5,
      medianMs: HOUR,
      p90Ms: 11 * DAY + 5 * HOUR,
    })

    // Each bucket's end goes a millisecond short: the engine's bounds hold both ends.
    const last = requests.find(
      (r) =>
        r.path === "/history/process-instance/count" &&
        r.query.startedAfter === "2026-11-23T00:00:00.000+0000",
    )
    expect(last?.query).toMatchObject({
      processDefinitionKey: "order",
      startedBefore: "2026-11-23T23:59:59.999+0000",
    })
    // An end event's bucket where nothing ended is no read; neither is one of an end event never reached.
    const perEvent = requests.filter((r) => r.query.executedActivityIdIn !== undefined)
    const bucketReads = perEvent.filter(
      (r) => r.query.finishedAfter !== "2026-11-11T00:00:00.000+0000",
    )
    expect(new Set(bucketReads.map((r) => r.query.finishedAfter))).toEqual(
      new Set([
        "2026-11-12T00:00:00.000+0000",
        "2026-11-20T00:00:00.000+0000",
        "2026-11-24T00:00:00.000+0000",
      ]),
    )
    // The rank reads: one row each, in the engine's order by duration.
    const ranks = requests.filter((r) => r.path === "/history/process-instance")
    expect(
      ranks.find((r) => r.query.executedActivityIdIn === undefined && r.query.firstResult === "2")
        ?.query,
    ).toMatchObject({
      sortBy: "duration",
      sortOrder: "asc",
      maxResults: "1",
    })
    // The diagrams of both versions an instance ended on, each counted by its id once.
    const cohorts = requests.filter((r) => r.query.processDefinitionId !== undefined)
    expect(cohorts.map((r) => r.query.processDefinitionId).sort()).toEqual([V1, V2])
  })

  it("reads no bucket of a series the range holds nothing of", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    // One instance runs since October: the history is written, the last 24 hours hold nothing.
    const quiet: Instance[] = [{ id: "old", definitionId: V2, start: at("2026-10-01T00:00:00Z") }]
    const { data, requests } = await call(
      statsWorld({ instances: quiet }),
      "engine_process_stats",
      { processDefinitionKey: "order", bucket: "hour" },
    )
    expect(data.buckets).toHaveLength(24)
    expect(data.totals).toEqual({ started: 0, ended: 0 })
    expect(data.history.recorded).toBe(true)
    expect(data.durations).toEqual({
      from: "2026-11-23T12:00:00.000Z",
      ended: 0,
      medianMs: null,
      p90Ms: null,
    })
    const counts = requests.filter((r) => r.path === "/history/process-instance/count")
    // The range's two counts and the last 24 hours' two: nothing per bucket, no version counted.
    expect(counts).toHaveLength(4)
    // One row of the open history, whether the engine writes it; no rank read.
    const rows = requests.filter((r) => r.path === "/history/process-instance")
    expect(rows.map((r) => r.query)).toEqual([{ unfinished: "true", maxResults: "1" }])
  })

  it("makes a bucket before the history kept a lower bound, and the durations start after it", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const { data } = await call(statsWorld({ ttl: { v1: 5, v2: 60 } }), "engine_process_stats", {
      processDefinitionKey: "order",
      bucket: "day",
    })
    expect(data.history).toEqual({
      timeToLiveDays: 5,
      keptFrom: "2026-11-19T12:00:00.000Z",
      recorded: true,
    })
    expect(data.totals).toEqual({ started: { atLeast: 5 }, ended: { atLeast: 5 } })
    expect(data.buckets[dayOf(data, "2026-11-12T00:00:00.000Z")]?.ended).toEqual({ atLeast: 1 })
    // The 19th starts before 12:00 that day: a lower bound too; the 20th is whole.
    expect(data.buckets[dayOf(data, "2026-11-19T00:00:00.000Z")]?.ended).toEqual({ atLeast: 0 })
    expect(data.buckets[dayOf(data, "2026-11-20T00:00:00.000Z")]?.ended).toBe(1)
    expect(data.buckets[dayOf(data, "2026-11-20T00:00:00.000Z")]?.endedAt.rejected).toBe(1)
    // c, b, a, f ended since the 20th: 10 s, 30 min, 1 h, 14 h.
    expect(data.durations).toEqual({
      from: "2026-11-20T00:00:00.000Z",
      ended: 4,
      medianMs: 30 * MINUTE,
      p90Ms: 14 * HOUR,
    })
    expect(data.endEvents[0]?.ended).toEqual({ atLeast: 4 })
    expect(data.now.startedLast24h).toBe(3)
  })

  it("follows the time zone's days and cuts to at most now", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const { data } = await call(statsWorld(), "engine_process_stats", {
      processDefinitionKey: "order",
      bucket: "day",
      timeZone: "Europe/Berlin",
      from: "2026-11-23T00:00:00+01:00",
      to: "2026-12-01",
    })
    expect(data.range).toEqual({
      from: "2026-11-22T23:00:00.000Z",
      to: "2026-11-24T12:00:00.000Z",
      bucket: "day",
      timeZone: "Europe/Berlin",
    })
    // d started at 00:59:59.999 on the 24th in Berlin.
    expect(data.buckets.map((bucket) => bucket.started)).toEqual([1, 3])
  })

  it("leaves a median unknown past the rank limit, and refuses what the buckets cannot hold", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const many = (request: RecordedRequest): FakeReply =>
      request.path === "/history/process-instance/count" &&
      request.query.finishedAfter !== undefined
        ? { body: { count: DURATION_RANK_LIMIT + 1 } }
        : statsWorld()(request)
    const { data, requests } = await call(many, "engine_process_stats", {
      processDefinitionKey: "order",
      bucket: "day",
      from: "2026-11-24",
    })
    expect(data.durations).toMatchObject({ medianMs: null, p90Ms: null })
    expect(requests.some((r) => r.path === "/history/process-instance")).toBe(false)
    await expect(
      call(statsWorld(), "engine_process_stats", {
        processDefinitionKey: "order",
        bucket: "hour",
        from: "2026-11-01",
      }),
    ).rejects.toThrow(/more than 48 hour buckets/)
    await expect(
      call(statsWorld(), "engine_process_stats", {
        processDefinitionKey: "order",
        bucket: "day",
        timeZone: "Mars/Olympus",
      }),
    ).rejects.toThrow(/IANA time zone/)
  })

  it("fails on a key the engine has no version of, and answers a repeat from its floor", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW })
    const none = (request: RecordedRequest): FakeReply =>
      request.path === "/process-definition" ? { body: [] } : statsWorld()(request)
    await expect(
      call(none, "engine_process_stats", { processDefinitionKey: "nope", bucket: "day" }),
    ).rejects.toThrow('No process definition with key "nope" is deployed on this engine.')

    const engine = await startFakeEngine({}, statsWorld())
    engines.push(engine)
    const registry = registryFor(engine)
    const config = tools.get("engine_process_stats")
    if (!config) throw new Error("engine_process_stats is not registered")
    const args = { processDefinitionKey: "order", bucket: "day" }
    const first = await callTool(config, registry, args)
    const reads = engine.requests.length
    expect(await callTool(config, registry, args)).toEqual(first)
    expect(engine.requests).toHaveLength(reads)
  })
})
