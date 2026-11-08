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
// to v2 (a tenant's), and only v1 has the element `legacyCheck`.

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
    {
      id: "legacyCheck",
      instances: 1,
      failedJobs: 1,
      incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
    },
  ],
  [V2]: [
    { id: "assess", instances: 3, failedJobs: 0, incidents: [] },
    {
      id: "sendPolicy",
      instances: 4,
      failedJobs: 2,
      incidents: [
        { incidentType: "failedJob", incidentCount: 2 },
        { incidentType: "custom", incidentCount: 1 },
      ],
    },
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
    ...overrides,
  }
}

async function build(overrides?: FakeRoutes) {
  const engine = await startFakeEngine(routes(overrides), { body: [] })
  engines.push(engine)
  const data = await buildActivityStatisticsData(clientFor(engine), { processDefinitionKey: KEY })
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
        },
        {
          activityId: "sendPolicy",
          activityName: "Send policy",
          inDiagram: true,
          running: 4,
          failedJobs: 2,
          incidents: 3,
        },
        // Only v1 has it: the latest diagram cannot draw it.
        {
          activityId: "legacyCheck",
          activityName: null,
          inDiagram: false,
          running: 1,
          failedJobs: 1,
          incidents: 1,
        },
      ],
    })
  })

  it("reads each version's statistics with failed jobs and incidents, and never the engine-wide ones", async () => {
    const { requests } = await build()

    const statistics = requests.filter((r) => r.path.endsWith("/statistics"))
    expect(statistics.map((r) => r.path).sort()).toEqual([
      `/process-definition/${V1}/statistics`,
      `/process-definition/${V2}/statistics`,
    ])
    for (const r of statistics) expect(r.query).toEqual({ failedJobs: "true", incidents: "true" })
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
    })

    expect(data.activities).toEqual([
      expect.objectContaining({ activityId: "assess", inDiagram: true, running: 4, failedJobs: 1 }),
    ])
  })

  it("lists only elements with something there", async () => {
    const { data } = await build({
      [`GET /process-definition/${V1}/statistics`]: {
        body: [{ id: "assess", instances: 0, failedJobs: 0, incidents: [] }, { instances: 3 }],
      },
      [`GET /process-definition/${V2}/statistics`]: { body: [] },
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
      ["sendPolicy", null, null],
      ["legacyCheck", null, null],
    ])
    // The counts stand: the diagram is enrichment.
    expect(data.activities.map((a) => a.running)).toEqual([5, 4, 1])
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
    })

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
