import { afterEach, describe, expect, it, vi } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeReply,
  type FakeRoutes,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { buildActivityStatisticsData } from "./activity-statistics-data.js"

// #335 N60: old versions keep running after a redeploy. Fixture: `leasing` v1 still runs next
// to v2 (a tenant's), and only v1 has the element `legacyCheck`. Each version's counts are the
// shared process screen's: its activity statistics with `failedJobs` (its jobs without retries from
// the same one read) and its incidents read whole, a root incident holding its token, a call
// activity's copy of a called instance's incident counted apart.

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const KEY = "leasing"
const V1 = "leasing:1:d1"
const V2 = "leasing:2:d2"
const XML =
  '<definitions><process id="leasing"><userTask id="assess" name="Assess creditworthiness"/><serviceTask id="sendPolicy" name="Send policy"/></process></definitions>'

const STATS: Record<string, unknown[]> = {
  [V1]: [
    { id: "assess", instances: 2, failedJobs: 0, incidents: [] },
    { id: "legacyCheck", instances: 1, failedJobs: 1, incidents: [] },
  ],
  [V2]: [
    { id: "assess", instances: 3, failedJobs: 0, incidents: [] },
    { id: "sendPolicy", instances: 4, failedJobs: 2, incidents: [] },
    { id: "callScoring", instances: 2, failedJobs: 0, incidents: [] },
  ],
}

/** An open incident at `activityId` of `definitionId`, a copy of `root` where one is named. */
function incident(id: string, definitionId: string, activityId: string, root = id) {
  return {
    id,
    processDefinitionId: definitionId,
    activityId,
    incidentType: "failedJob",
    incidentTimestamp: "2026-11-20T08:00:00.000+0000",
    rootCauseIncidentId: root,
  }
}

/**
 * v1: a root incident at `legacyCheck`. v2: two root incidents at `sendPolicy` (one more token runs
 * there unheld) and one of a custom type, and at the call activity `callScoring` two copies of a
 * called instance's incidents, which count apart and hold no token of their own.
 */
const INCIDENTS: Record<string, unknown[]> = {
  [V1]: [incident("i1", V1, "legacyCheck")],
  [V2]: [
    incident("i2", V2, "sendPolicy"),
    incident("i3", V2, "sendPolicy"),
    { ...incident("i4", V2, "sendPolicy"), incidentType: "custom" },
    incident("c1", V2, "callScoring", "r1"),
    incident("c2", V2, "callScoring", "r2"),
  ],
}

function routes(overrides: FakeRoutes = {}): FakeRoutes {
  return {
    "GET /process-definition": (r: RecordedRequest) => ({
      body: r.query.latestVersion
        ? [{ id: V2, key: KEY, name: "Leasing", version: 2, tenantId: "acme" }]
        : [
            { id: V2, key: KEY, name: "Leasing", version: 2, tenantId: "acme" },
            { id: V1, key: KEY, name: "Leasing", version: 1 },
          ],
    }),
    [`GET /process-definition/${V1}/statistics`]: { body: STATS[V1] },
    [`GET /process-definition/${V2}/statistics`]: { body: STATS[V2] },
    [`GET /process-definition/${V2}/xml`]: { body: { id: V2, bpmn20Xml: XML } },
    "GET /incident": (r: RecordedRequest) => ({
      body: INCIDENTS[r.query.processDefinitionId ?? ""] ?? [],
    }),
    ...overrides,
  }
}

async function build(overrides?: FakeRoutes) {
  const engine = await startFakeEngine(routes(overrides), { body: [] })
  engines.push(engine)
  const data = await buildActivityStatisticsData(clientFor(engine), {
    processDefinitionKey: KEY,
    source: "runtime",
  })
  if (data.source !== "runtime") throw new Error("runtime asked, history answered")
  return { data, requests: engine.requests }
}

describe("buildActivityStatisticsData", () => {
  it("sums every version per element onto the latest diagram, most running first", async () => {
    const { data } = await build()

    expect(data).toEqual({
      processDefinitionKey: KEY,
      source: "runtime",
      diagramDefinitionId: V2,
      diagramVersion: 2,
      versionCount: 2,
      activities: [
        {
          activityId: "assess",
          activityName: "Assess creditworthiness",
          inDiagram: true,
          running: 5,
          failedJobs: 0,
          incidents: 0,
          incidentsInCalledInstances: 0,
        },
        // The call activity's tokens wait on their called instances: running, their incidents
        // apart and never in its incident count.
        {
          activityId: "callScoring",
          activityName: null,
          inDiagram: false,
          running: 2,
          failedJobs: 0,
          incidents: 0,
          incidentsInCalledInstances: 2,
        },
        // Three of its four tokens are held by its root incidents.
        {
          activityId: "sendPolicy",
          activityName: "Send policy",
          inDiagram: true,
          running: 1,
          failedJobs: 2,
          incidents: 3,
          incidentsInCalledInstances: 0,
        },
        // Only v1 has it: the latest diagram cannot draw it; its one token is its incident's.
        {
          activityId: "legacyCheck",
          activityName: null,
          inDiagram: false,
          running: 0,
          failedJobs: 1,
          incidents: 1,
          incidentsInCalledInstances: 0,
        },
      ],
    })
  })

  it("reads each version's statistics once, with its failed jobs, and its incidents whole, never the engine-wide ones", async () => {
    const { requests } = await build()

    const statistics = requests.filter((r) => r.path.endsWith("/statistics"))
    expect(statistics.map((r) => [r.path, r.query]).sort()).toEqual([
      [`/process-definition/${V1}/statistics`, { failedJobs: "true" }],
      [`/process-definition/${V2}/statistics`, { failedJobs: "true" }],
    ])
    const incidents = requests.filter((r) => r.path === "/incident")
    expect(incidents.map((r) => r.query.processDefinitionId).sort()).toEqual([V1, V2])
    expect(requests.some((r) => r.path === "/process-definition/statistics")).toBe(false)
  })

  it("stands a multi-instance body on its element, never as an element of its own", async () => {
    const { data } = await build({
      [`GET /process-definition/${V1}/statistics`]: { body: [] },
      [`GET /process-definition/${V2}/statistics`]: {
        body: [
          { id: "assess#multiInstanceBody", instances: 1, failedJobs: 1, incidents: [] },
          { id: "assess", instances: 3, failedJobs: 0, incidents: [] },
        ],
      },
      "GET /incident": { body: [] },
    })

    expect(data.activities).toEqual([
      expect.objectContaining({ activityId: "assess", inDiagram: true, running: 4, failedJobs: 1 }),
    ])
  })

  it("lists only elements with something there", async () => {
    const { data } = await build({
      [`GET /process-definition/${V1}/statistics`]: {
        body: [{ id: "assess", instances: 0, failedJobs: 0, incidents: [] }],
      },
      [`GET /process-definition/${V2}/statistics`]: { body: [] },
      "GET /incident": { body: [] },
    })

    expect(data.activities).toEqual([])
    expect(data.versionCount).toBe(2)
  })

  it("leaves names and the diagram scope unknown when the diagram is unreadable", async () => {
    const { data } = await build({
      [`GET /process-definition/${V2}/xml`]: { status: 500, body: { message: "db down" } },
    })

    expect(data.activities.map((a) => [a.activityId, a.activityName, a.inDiagram])).toEqual([
      ["assess", null, null],
      ["callScoring", null, null],
      ["sendPolicy", null, null],
      ["legacyCheck", null, null],
    ])
    // The counts stand: the diagram is enrichment.
    expect(data.activities.map((a) => a.running)).toEqual([5, 2, 1, 0])
  })

  // The floor: a version's counts read its incidents whole, which loads the engine's database.
  it("reads a version again for the same caller only after the floor of 30 s", async () => {
    const engine = await startFakeEngine(routes(), { body: [] })
    engines.push(engine)
    const client = clientFor(engine)
    const counted = () =>
      engine.requests.filter((r) => r.path.endsWith("/statistics") || r.path === "/incident").length
    const start = Date.now()
    const clock = vi.spyOn(Date, "now").mockReturnValue(start)
    try {
      const first = await buildActivityStatisticsData(client, {
        processDefinitionKey: KEY,
        source: "runtime",
      })
      const read = counted()
      expect(read).toBe(4)

      clock.mockReturnValue(start + 29_000)
      const again = await buildActivityStatisticsData(client, {
        processDefinitionKey: KEY,
        source: "runtime",
      })
      expect(counted()).toBe(read)
      expect(again).toEqual(first)

      clock.mockReturnValue(start + 30_000)
      await buildActivityStatisticsData(client, { processDefinitionKey: KEY, source: "runtime" })
      expect(counted()).toBe(2 * read)
    } finally {
      clock.mockRestore()
    }
  })

  // The load guard: a key with many versions never fans out in one burst, however slow the reads.
  it("reads at most four versions' statistics at once", async () => {
    const ids = [6, 5, 4, 3, 2, 1].map((v) => `leasing:${v}:d${v}`)
    const held: Array<() => void> = []
    let open = 0
    let most = 0
    let releasing = false
    const hold = (): Promise<FakeReply> => {
      open += 1
      most = Math.max(most, open)
      return new Promise((resolve) => {
        const answer = () => {
          open -= 1
          resolve({ body: [{ id: "assess", instances: 1, failedJobs: 0, incidents: [] }] })
        }
        if (releasing) answer()
        else held.push(answer)
      })
    }
    const pending = build({
      "GET /process-definition": (r) => ({
        body: (r.query.latestVersion ? ids.slice(0, 1) : ids).map((id) => ({
          id,
          key: KEY,
          version: Number(id.split(":")[1]),
        })),
      }),
      ...Object.fromEntries(ids.map((id) => [`GET /process-definition/${id}/statistics`, hold])),
      "GET /incident": { body: [] },
    })

    // Each version's one statistics read: four versions at once, in one pool.
    await vi.waitFor(() => expect(held).toHaveLength(4))
    // The fifth waits for a free slot while the four are held.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(held).toHaveLength(4)

    releasing = true
    held.splice(0).forEach((answer) => answer())
    const { data } = await pending
    expect(most).toBe(4)
    // Every version still counts.
    expect(data.activities).toEqual([expect.objectContaining({ activityId: "assess", running: 6 })])
  })
})
