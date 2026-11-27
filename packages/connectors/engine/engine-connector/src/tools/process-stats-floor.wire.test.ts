import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { readStatistics } from "../data/statistics-floor.js"
import { oneAtATime } from "../lib/engine/per-engine.js"
import { resolveEngine } from "../lib/engine/resolve-engine.js"
import { registerProcessNumberTools } from "./process-numbers.js"
import { ENGINE_FAILURE } from "./test-support/engine-world.js"
import {
  callTool,
  captureTools,
  registryFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
} from "./test-support/fake-engine.js"
import { NOW, statsWorld, V1, V2 } from "./test-support/stats-world.js"
import type { ProcessStatsData } from "../data/process-stats-data.js"

/**
 * `engine_process_stats`' floor on the wire (F29, owner decision 2026-11-26): what one call asks
 * the engine, a repeat within 30 s of the same range, arguments that cut to it, the range served
 * as its answer names it, another caller, an answer's age from its oldest read, and builds of
 * distinct ranges on one engine, which go one at a time in a turn of their own.
 */

const tools = captureTools(registerProcessNumberTools)
const ARGS = { processDefinitionKey: "order", bucket: "day" }

const engines: FakeEngine[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

/** The stats world as one configured engine, and the tool called on it as `user`. */
async function statsEngine(
  answer: (request: RecordedRequest) => FakeReply | Promise<FakeReply> = statsWorld(),
) {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW })
  const engine = await startFakeEngine({}, answer)
  engines.push(engine)
  const registry = registryFor(engine)
  const config = tools.get("engine_process_stats")
  if (!config) throw new Error("engine_process_stats is not registered")
  const stats = (args: object, user = "ada") =>
    runWithMcpRequestInfo(
      { authUserId: user, authorization: `Bearer ${user}` },
      () =>
        callTool(config, registry, args as Record<string, unknown>) as Promise<ProcessStatsData>,
    )
  return { engine, stats, client: resolveEngine("fake", registry).client }
}

/** A promise the test settles, and the call that settles it. */
function held() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const at = (ms: number) => new Date(NOW + ms).toISOString()

/** The requests per path, a definition's id named `<id>`. */
function perPath(requests: readonly RecordedRequest[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const { path } of requests) {
    const route = path.replace(V1, "<id>").replace(V2, "<id>")
    counts[route] = (counts[route] ?? 0) + 1
  }
  return counts
}

describe("engine_process_stats' floor", () => {
  it("asks the engine 60 times for 14 days, and nothing again within 30 s", async () => {
    const { engine, stats } = await statsEngine()
    const first = await stats(ARGS)
    expect(perPath(engine.requests)).toEqual({
      "/process-definition": 1,
      "/process-definition/statistics": 1,
      "/process-instance/count": 2,
      "/job/count": 1,
      "/task/count": 1,
      // The range's and the last 24 hours' started and ended (4), the two versions counted for
      // the diagrams an instance ended on (2), 14 buckets started and 14 ended, the three end
      // events' totals (3), and each end event's buckets where an instance ended (3 × 3).
      "/history/process-instance/count": 46,
      "/process-definition/<id>/xml": 2,
      // The median and P90 overall and of "shipped", one rank each of "notified" and "rejected".
      "/history/process-instance": 6,
    })
    vi.setSystemTime(NOW + 29_999)
    expect(await stats(ARGS)).toEqual(first)
    expect(engine.requests).toHaveLength(60)
  })

  it("answers instants 1 ms apart from one build, the range cut to whole minutes", async () => {
    const { engine, stats } = await statsEngine()
    const range = { ...ARGS, from: "2026-11-23T09:59:30.000Z", to: "2026-11-24T09:15:00.001Z" }
    const first = await stats(range)
    const reads = engine.requests.length
    const near = await stats({
      ...range,
      from: "2026-11-23T09:59:30.001Z",
      to: "2026-11-24T09:15:00.002Z",
    })
    const fromOnly = await stats({ ...range, to: "2026-11-24T09:16:00.000Z" })
    const whole = await stats({
      ...range,
      from: "2026-11-23T09:59:00.000Z",
      to: "2026-11-24T09:16:00.000Z",
    })
    expect(engine.requests).toHaveLength(reads)
    // What was read: the cut instants, and the first bucket from the cut `from`.
    expect(first.range).toEqual({
      from: "2026-11-23T09:59:00.000Z",
      to: "2026-11-24T09:16:00.000Z",
      bucket: "day",
      timeZone: "UTC",
      cut: "from cut down to a whole minute; to cut up to a whole minute",
    })
    expect(first.buckets[0]?.start).toBe("2026-11-23T09:59:00.000Z")
    expect(near).toEqual(first)
    expect(fromOnly.range.cut).toBe("from cut down to a whole minute")
    expect(whole.range).not.toHaveProperty("cut")
    expect({ ...whole, range: first.range }).toEqual(first)
  })

  it("reads a to at now or later, or one the cut brings there, as up to now", async () => {
    const { engine, stats } = await statsEngine()
    const first = await stats(ARGS)
    const reads = engine.requests.length
    const later = await stats({ ...ARGS, to: "2099-01-01" })
    const cutToNow = await stats({ ...ARGS, to: at(-30_000) })
    expect(engine.requests).toHaveLength(reads)
    expect(later).toEqual({
      ...first,
      range: {
        ...first.range,
        cut: "to read up to now as of the build, which ends before the asked to",
      },
    })
    expect(cutToNow.range).toMatchObject({ to: at(0), cut: "to read up to now as of the build" })
  })

  it("names a kept build up to now that ends before a to asked since, never a cut up", async () => {
    const { engine, stats } = await statsEngine()
    const first = await stats(ARGS)
    const reads = engine.requests.length
    vi.setSystemTime(NOW + 20_000)
    // In the current minute, so the cut brings it to now: the build of 20 s ago answers.
    const kept = await stats({ ...ARGS, to: at(10_000) })
    expect(engine.requests).toHaveLength(reads)
    expect(kept).toEqual({
      ...first,
      range: {
        ...first.range,
        cut: "to read up to now as of the build, which ends before the asked to",
      },
    })
    expect(kept.range.to).toBe(at(0))
  })

  it("builds anew where the asked from lies past a kept build's to, then keeps that build", async () => {
    const { engine, stats } = await statsEngine()
    const hour = { ...ARGS, bucket: "hour" }
    vi.setSystemTime(NOW + 40_000)
    await stats({ ...hour, from: at(30_000) })
    const reads = engine.requests.length
    vi.setSystemTime(NOW + 50_000)
    const later = await stats({ ...hour, from: at(45_000) })
    const rebuilt = engine.requests.length
    expect(rebuilt).toBeGreaterThan(reads)
    // The range it read holds the span asked, its from cut down to the whole minute.
    expect(later.range).toEqual({
      from: at(0),
      to: at(50_000),
      bucket: "hour",
      timeZone: "UTC",
      cut: "from cut down to a whole minute",
    })
    expect(later.buckets.map((b) => [b.start, b.end])).toEqual([[at(0), at(50_000)]])
    // That build answers the key now: the first from of the minute reads nothing again.
    expect((await stats({ ...hour, from: at(30_000) })).range.to).toBe(at(50_000))
    expect(engine.requests).toHaveLength(rebuilt)
  })

  it("serves no call that joined a build ending before its from: each reads until one holds it", async () => {
    const world = statsWorld()
    const first = held()
    let builds = 0
    const { engine, stats } = await statsEngine(async (request) => {
      // The first build waits, so the two calls after it join it while it is still out.
      if (request.path === "/process-definition" && ++builds === 1) await first.promise
      return world(request)
    })
    const hour = { ...ARGS, bucket: "hour" }
    vi.setSystemTime(NOW + 40_000)
    const kept = stats({ ...hour, from: at(30_000) })
    await vi.waitFor(() => expect(engine.requests).not.toHaveLength(0))
    // Both cut to the same minute, so they share the build up to 12:00:40, which ends before them.
    vi.setSystemTime(NOW + 50_000)
    const later = stats({ ...hour, from: at(45_000) })
    vi.setSystemTime(NOW + 55_000)
    const last = stats({ ...hour, from: at(52_000) })
    await new Promise((resolve) => setTimeout(resolve, 20))
    first.release()
    const served = await Promise.all([kept, later, last])
    // The second call builds up to its now; the third joins that build, which still ends before
    // its from, and builds up to its own.
    expect(served.map((data) => data.range.to)).toEqual([at(40_000), at(50_000), at(55_000)])
    expect(builds).toBe(3)
    // The last build answers the minute's key from then on.
    const reads = engine.requests.length
    expect((await stats({ ...hour, from: at(30_000) })).range.to).toBe(at(55_000))
    expect(engine.requests).toHaveLength(reads)
  })

  it("reads anew for another caller, never from the first one's build", async () => {
    const { engine, stats } = await statsEngine()
    await stats(ARGS, "ada")
    const reads = engine.requests.length
    await stats(ARGS, "bob")
    expect(engine.requests).toHaveLength(2 * reads)
    await stats(ARGS, "ada")
    expect(engine.requests).toHaveLength(2 * reads)
  })

  it("ages an answer from its oldest read, the statistics it counts the incidents from", async () => {
    const { engine, stats, client } = await statsEngine()
    // The caller's statistics read, kept since NOW: the build 25 s later counts from it.
    await runWithMcpRequestInfo({ authUserId: "ada", authorization: "Bearer ada" }, () =>
      readStatistics(client),
    )
    vi.setSystemTime(NOW + 25_000)
    const first = await stats(ARGS)
    expect(first.asOf).toBe(at(0))
    const reads = engine.requests.length
    vi.setSystemTime(NOW + 29_999)
    await stats(ARGS)
    expect(engine.requests).toHaveLength(reads)
    vi.setSystemTime(NOW + 30_000)
    expect((await stats(ARGS)).asOf).toBe(at(30_000))
    expect(engine.requests.length).toBeGreaterThan(reads)
  })

  it("shares a build waiting its turn however long it waits, its 30 s from its asOf", async () => {
    const world = statsWorld()
    let builds = 0
    let repeat: Promise<ProcessStatsData> | undefined
    const { stats } = await statsEngine((request) => {
      if (request.path !== "/process-definition") return world(request)
      // The first build takes 31 s, while the second range waits its turn; its repeat comes then.
      if (++builds === 1) {
        vi.setSystemTime(NOW + 31_000)
        repeat = stats({ ...ARGS, from: "2026-11-22" })
      }
      return world(request)
    })
    const [, second] = await Promise.all([
      stats({ ...ARGS, from: "2026-11-20" }),
      stats({ ...ARGS, from: "2026-11-22" }),
    ])
    // The repeat shared the second build while it waited: two ranges, two builds.
    expect(await repeat).toEqual(second)
    expect(builds).toBe(2)
  })

  it("leaves the single reads of oneAtATime free while a build holds its turn", async () => {
    const world = statsWorld()
    const build = held()
    const { engine, stats, client } = await statsEngine(async (request) => {
      if (request.path === "/process-definition") await build.promise
      return world(request)
    })
    const open = stats(ARGS)
    await vi.waitFor(() => expect(engine.requests).not.toHaveLength(0))
    // A Throughput read on the same engine does not wait for the build held in its turn.
    let read = false
    void oneAtATime(client, async () => {
      read = true
    })
    await vi.waitFor(() => expect(read).toBe(true))
    build.release()
    await open
  })

  it("ranks in oneAtATime's turns: a build's counts go ahead, its sorts wait", async () => {
    const throughput = held()
    const { engine, stats, client } = await statsEngine()
    const reading = oneAtATime(client, () => throughput.promise)
    const open = stats(ARGS)
    const ranks = () => engine.requests.filter((r) => r.path === "/history/process-instance")
    // Every read of the 60 but the six ranks reaches the engine while another read holds the turn.
    await vi.waitFor(() => expect(engine.requests).toHaveLength(54))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ranks()).toEqual([])
    throughput.release()
    await reading
    await open
    expect(ranks()).toHaveLength(6)
  })

  it("builds two ranges on one engine one after the other, never at once", async () => {
    const world = statsWorld()
    let firstAnswered = false
    // Whether the first call had answered when each build's first read reached the engine.
    const builds: boolean[] = []
    const { engine, stats } = await statsEngine((request) => {
      if (request.path === "/process-definition") builds.push(firstAnswered)
      return world(request)
    })
    const [first, second] = await Promise.all([
      stats({ ...ARGS, from: "2026-11-20" }).then((data) => {
        firstAnswered = true
        return data
      }),
      stats({ ...ARGS, from: "2026-11-22" }),
    ])
    expect(builds).toEqual([false, true])
    expect([first.range.from, second.range.from]).toEqual([
      "2026-11-20T00:00:00.000Z",
      "2026-11-22T00:00:00.000Z",
    ])
    // Both count the open root incidents from the caller's one statistics read (F123's floor).
    const statistics = engine.requests.filter((r) => r.path === "/process-definition/statistics")
    expect(statistics).toHaveLength(1)
  })

  it("keeps no answer that misses a part: the next call builds again", async () => {
    const world = statsWorld({ instances: [] })
    let failing = true
    // Whether the engine writes history, asked where the history holds nothing, fails once.
    const { engine, stats } = await statsEngine((request) =>
      request.path === "/process-instance" && failing ? ENGINE_FAILURE : world(request),
    )
    const missed = await stats(ARGS)
    failing = false
    const reads = engine.requests.length
    const whole = await stats(ARGS)
    expect([missed.history.recorded, whole.history.recorded]).toEqual([null, false])
    // Built again, its history counts sent anew; that answer is whole, so the floor keeps it.
    const rebuilt = engine.requests.slice(reads)
    expect(rebuilt.filter((r) => r.path === "/history/process-instance/count")).toHaveLength(4)
    await stats(ARGS)
    expect(engine.requests).toHaveLength(reads + rebuilt.length)
  })
})
