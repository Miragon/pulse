import { afterEach, describe, expect, it } from "vitest"
import { isRootIncident } from "@miragon/pulse-c7-core"
import { C7_SCREEN_ENGINE } from "@miragon/pulse-c7-core/testing"
import { runWithMcpRequestInfo } from "@miragon/pulse-widget-shell/server"
import { cibsevenProvider } from "../providers/index.js"
import { WORLD, worldReply } from "../tools/test-support/engine-world.js"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { buildActivityStatisticsData } from "./activity-statistics-data.js"
import { readElementCounts } from "./element-counts.js"
import { buildProcessIncidentsData } from "./process-incidents-data.js"
import { readStatistics } from "./statistics-floor.js"

// F27 (#691): the element counts read only the versions the engine-wide statistics name held
// (running instances, jobs without retries, open root incidents); every other version's element
// statistics are all zero, so it counts zero and costs no read. On a cold statistics floor a few
// versions are read each instead, which costs less than the engine-wide read: the same numbers.

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const KEY = "claims"
const idOf = (n: number) => `${KEY}:${String(n)}:d${String(n)}`

/** A version's row of the engine-wide statistics, idle unless `counts` say otherwise. */
const statisticsRow = (n: number, counts: object = {}) => ({
  id: idOf(n),
  instances: 0,
  failedJobs: 0,
  incidents: [],
  ...counts,
  definition: { id: idOf(n), key: KEY, version: n },
})

/** One token waiting at `task` of a version: what each held version's element statistics hold. */
const ONE_TOKEN = [{ id: "task", instances: 1, failedJobs: 0, incidents: [] }]

const ELEMENT_STATISTICS = /^\/process-definition\/(.+)\/statistics$/

/** An engine over these statistics rows, each version answering `elements` (none: all zero). */
async function engineOver(rows: unknown[], elements: (id: string) => unknown[]) {
  const engine = await startFakeEngine({}, (request: RecordedRequest): FakeReply => {
    if (request.path === "/process-definition/statistics") return { body: rows }
    const version = ELEMENT_STATISTICS.exec(request.path)?.[1]
    return { body: version === undefined ? [] : elements(version) }
  })
  engines.push(engine)
  // The engine-wide `/process-definition/statistics` names no version, so it is none of them.
  const versionsRead = () =>
    engine.requests.flatMap((r) => ELEMENT_STATISTICS.exec(r.path)?.slice(1, 2) ?? [])
  const statisticsReads = () =>
    engine.requests.filter((r) => r.path === "/process-definition/statistics").length
  return { engine, client: clientFor(engine), versionsRead, statisticsReads }
}

const as = <T>(user: string, call: () => Promise<T>) =>
  runWithMcpRequestInfo({ authUserId: user, authorization: `Bearer ${user}` }, call)

describe("readElementCounts: the versions that hold something", () => {
  /** Versions 6 to 1: 6 runs instances, 5 and 4 hold a version without one, 3 to 1 are idle. */
  const SIX = [
    statisticsRow(6, { instances: 2 }),
    // A failed timer start's job and a root incident hold a version without an instance.
    statisticsRow(5, { failedJobs: 1 }),
    statisticsRow(4, { incidents: [{ incidentType: "custom", incidentCount: 1 }] }),
    ...[3, 2, 1].map((n) => statisticsRow(n)),
  ]
  const heldOfSix = (id: string) => ([idOf(6), idOf(5), idOf(4)].includes(id) ? ONE_TOKEN : [])
  const THREE_TOKENS = new Map([
    ["task", { active: 3, incidents: 0, incidentsInCalledInstances: 0, failedJobs: 0 }],
  ])

  it("reads only the held versions on a warm statistics floor, an idle one counting the zero the engine would give", async () => {
    const { client, versionsRead, statisticsReads } = await engineOver(SIX, heldOfSix)
    await readStatistics(client)

    const counts = await readElementCounts(client, [6, 5, 4, 3, 2, 1].map(idOf))

    expect(versionsRead().sort()).toEqual([idOf(4), idOf(5), idOf(6)])
    expect(statisticsReads()).toBe(1)
    // The same counts as reading every version: the idle ones answer all zero.
    expect(counts).toEqual(THREE_TOKENS)
  })

  it("reads each of a few versions on a cold statistics floor, never the engine-wide read: the same numbers", async () => {
    const { client, versionsRead, statisticsReads } = await engineOver(SIX, heldOfSix)

    const counts = await readElementCounts(client, [6, 5, 4, 3, 2, 1].map(idOf))

    expect(versionsRead()).toHaveLength(6)
    expect(statisticsReads()).toBe(0)
    expect(counts).toEqual(THREE_TOKENS)
  })

  it("reads the statistics once on a cold floor past 8 versions, then only the held ones", async () => {
    const rows = [
      statisticsRow(9, { instances: 1 }),
      ...[8, 7, 6, 5, 4, 3, 2, 1].map((n) => statisticsRow(n)),
    ]
    const { client, versionsRead, statisticsReads } = await engineOver(rows, (id) =>
      id === idOf(9) ? ONE_TOKEN : [],
    )
    const every = [9, 8, 7, 6, 5, 4, 3, 2, 1].map(idOf)

    const counts = await readElementCounts(client, every)

    expect(statisticsReads()).toBe(1)
    expect(versionsRead()).toEqual([idOf(9)])
    expect(counts.get("task")?.active).toBe(1)
    // The statistics read answers the caller's next call, a cold one would not have sent it.
    await readElementCounts(client, every.slice(0, 2))
    expect(statisticsReads()).toBe(1)
    expect(versionsRead()).toEqual([idOf(9)])
  })

  it("reads a version the statistics do not list: deployed since, it may hold something", async () => {
    const { client, versionsRead } = await engineOver([statisticsRow(1)], () => ONE_TOKEN)
    await readStatistics(client)

    const counts = await readElementCounts(client, [idOf(2), idOf(1)])

    expect(versionsRead()).toEqual([idOf(2)])
    expect(counts.get("task")?.active).toBe(1)
  })

  it("reads no statistics for no version", async () => {
    const { engine, client } = await engineOver([], () => ONE_TOKEN)
    expect(await readElementCounts(client, [])).toEqual(new Map())
    expect(engine.requests).toEqual([])
  })
})

describe("readElementCounts: its floor per caller and key", () => {
  // Past the old bound of 256 versions per engine, shared by every caller.
  const HELD = 300
  const ids = Array.from({ length: HELD }, (_, i) => idOf(HELD - i))
  const otherKey = Array.from({ length: HELD }, (_, i) => `other:${String(i + 1)}:o${String(i)}`)
  const otherRows = otherKey.map((id, i) => ({
    ...statisticsRow(i + 1, { instances: 1 }),
    id,
    definition: { id, key: "other", version: i + 1 },
  }))

  it("reads each of a key's held versions once in the floor, whatever another caller reads", async () => {
    const rows = [...ids.map((_, i) => statisticsRow(HELD - i, { instances: 1 })), ...otherRows]
    const { client, versionsRead } = await engineOver(rows, () => ONE_TOKEN)

    const first = await as("ada", () => readElementCounts(client, ids))
    expect(versionsRead()).toHaveLength(HELD)
    expect(first.get("task")?.active).toBe(HELD)

    // Bob reads the key and another as large: his own reads, none of them evicting Ada's.
    await as("bob", () => readElementCounts(client, ids))
    await as("bob", () => readElementCounts(client, otherKey))
    expect(versionsRead()).toHaveLength(3 * HELD)

    expect(await as("ada", () => readElementCounts(client, ids))).toEqual(first)
    expect(versionsRead()).toHaveLength(3 * HELD)
    expect(new Set(versionsRead().slice(0, HELD)).size).toBe(HELD)
  })
})

describe("what a version's element statistics count lives on its running instances", () => {
  // c7-core's recorded screen engine (Operaton): DSP-3001 of pulse-dispatch waits at its call
  // activity for the root incident of the instance of pulse-label it called, whose job ran out of
  // retries; the call activity holds a copy of that incident.
  const ROOT = "/engine-rest"
  const answered = (path: string) =>
    C7_SCREEN_ENGINE.answers.flatMap((a) => (a.path === path && "answer" in a ? [a.answer] : []))
  const statistics = answered(`${ROOT}/process-definition/statistics`)[0] as Array<{
    id: string
    instances: number
    incidents: unknown[]
  }>
  const instancesOf = (definitionId: string) =>
    statistics.find((row) => row.id === definitionId)?.instances ?? 0
  interface Held {
    processInstanceId?: string | null
    processDefinitionId: string
  }
  const running = (row: Held) =>
    answered(`${ROOT}/process-instance/${row.processInstanceId ?? ""}`).length > 0

  it("a copy at a call activity: on the instance that waits at the call, its version held by it", () => {
    const incidents = answered(`${ROOT}/incident`).flat() as Array<Held & { id: string }>
    const copies = incidents.filter((incident) => !isRootIncident(incident))
    expect(copies.length).toBeGreaterThan(0)
    for (const copy of copies) {
      expect(running(copy)).toBe(true)
      expect(instancesOf(copy.processDefinitionId)).toBeGreaterThan(0)
      // Its version counts no root incident: its running instance alone holds it.
      expect(statistics.find((row) => row.id === copy.processDefinitionId)?.incidents).toEqual([])
    }
  })

  it("a job without retries: on a running instance, its version held by it", () => {
    const jobs = answered(`${ROOT}/job`).flat() as Array<Held & { retries: number }>
    const failed = jobs.filter((job) => job.retries === 0)
    expect(failed.length).toBeGreaterThan(0)
    for (const job of failed) {
      expect(running(job)).toBe(true)
      expect(instancesOf(job.processDefinitionId)).toBeGreaterThan(0)
    }
  })
})

describe("the cockpit's process route on a key with idle versions", () => {
  // The world's key `order`: v1 holds a root incident and a job without retries, v2 a caller
  // waiting at its call activity with the copy; 30 older versions of the process run nothing.
  const IDLE = Array.from({ length: 30 }, (_, i) => ({
    id: `order:0:idle-${String(i)}`,
    key: WORLD.key,
    name: "Order",
    version: 0,
  }))

  function idleWorld(request: RecordedRequest): FakeReply {
    const reply = worldReply(request)
    const { path, query } = request
    if (path === "/process-definition/statistics") {
      const idle = IDLE.map((definition) => ({ id: definition.id, instances: 0, definition }))
      return { body: [...(reply.body as unknown[]), ...idle] }
    }
    const everyVersion = path === "/process-definition" && query.key && !query.latestVersion
    return everyVersion ? { body: [...(reply.body as unknown[]), ...IDLE] } : reply
  }

  it("reads the element statistics of the held versions alone, on one engine-wide read", async () => {
    const engine = await startFakeEngine({}, idleWorld)
    engines.push(engine)
    const client = clientFor(engine)
    const key = { processDefinitionKey: WORLD.key }

    const [incidents, running] = await Promise.all([
      buildProcessIncidentsData(client, {
        baseUrl: engine.baseUrl,
        provider: cibsevenProvider,
        ...key,
      }),
      buildActivityStatisticsData(client, { ...key, source: "runtime" }),
    ])

    const read = (pattern: RegExp) => engine.requests.filter((r) => pattern.test(r.path))
    // Two of 32 versions, where every version was read before; the rest count zero.
    expect(
      read(/^\/process-definition\/[^/]+\/statistics$/)
        .map((r) => r.path)
        .sort(),
    ).toEqual([
      `/process-definition/${WORLD.instanceDefinitionId}/statistics`,
      `/process-definition/${WORLD.latestDefinitionId}/statistics`,
    ])
    expect(read(/^\/process-definition\/statistics$/)).toHaveLength(1)
    if (running.source !== "runtime") throw new Error("runtime asked, history answered")
    expect(running.versionCount).toBe(32)
    expect(running.activities.map((a) => [a.activityId, a.running, a.incidents])).toEqual([
      [WORLD.activityId, 1, 1],
      [WORLD.callActivityId, 1, 0],
    ])
    expect(incidents.incidentCount).toBe(1)
  })
})
