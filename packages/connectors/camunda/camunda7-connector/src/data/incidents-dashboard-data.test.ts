import { afterEach, describe, expect, it } from "vitest"
import { toEngineDate } from "@miragon/pulse-camunda7-client"
import { cibsevenProvider } from "../providers/index.js"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { buildIncidentsDashboardData } from "./incidents-dashboard-data.js"

// #335 N61: a burst on one process must not push another off the overview.

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

const HOUR = 60 * 60 * 1000

const row = (n: number, key: string, activityId: string, ageMs: number) => ({
  id: `${key}-${n}`,
  processDefinitionId: `${key}:1:d`,
  processInstanceId: `pi-${key}-${n}`,
  activityId,
  incidentType: "failedJob",
  incidentMessage: `${activityId} failed`,
  incidentTimestamp: toEngineDate(new Date(Date.now() - ageMs)),
  configuration: null,
})

const stats = (key: string, version: number, instances: number, incidentCount: number) => ({
  id: `${key}:${version}:d`,
  instances,
  incidents: incidentCount ? [{ incidentType: "failedJob", incidentCount }] : [],
  definition: { id: `${key}:${version}:d`, key, name: key.toUpperCase(), version },
})

function routes(scan: unknown[], counts: { total: number; last24h: number }): FakeRoutes {
  return {
    "GET /incident": { body: scan },
    "GET /incident/count": (r: RecordedRequest) => ({
      body: { count: r.query.incidentTimestampAfter ? counts.last24h : counts.total },
    }),
    "GET /process-definition/statistics": {
      body: [
        stats("burst", 1, 10, 100),
        stats("burst", 2, 20, 150),
        stats("quiet", 1, 5, 7),
        stats("idle", 1, 3, 0),
      ],
    },
  }
}

async function build(
  r: FakeRoutes,
  filter: { processDefinitionKey?: string; incidentType?: string } = {},
) {
  const engine = await startFakeEngine(r, { body: [] })
  engines.push(engine)
  const data = await buildIncidentsDashboardData(clientFor(engine), {
    baseUrl: engine.baseUrl,
    provider: cibsevenProvider,
    ...filter,
  })
  return { data, requests: engine.requests }
}

describe("buildIncidentsDashboardData — exact cards beyond the scan (#335 N61)", () => {
  it("keeps a process whose incidents all lie beyond the 200-row scan, with its exact count", async () => {
    // 257 open incidents: a 250-incident burst in the last minutes fills the
    // whole scan; quiet's 7 older incidents are all beyond it.
    const scan = Array.from({ length: 200 }, (_, n) =>
      row(n, "burst", n % 4 ? "charge" : "ship", n * 1000),
    )
    const { data, requests } = await build(routes(scan, { total: 257, last24h: 251 }))

    expect(data).toMatchObject({
      totalCount: 257,
      processCount: 2,
      last24hCount: 251,
      // Neither card's breakdown is complete — unknown, not a sum of scans.
      affectedActivityCount: null,
      latestIncident: scan[0].incidentTimestamp,
    })
    const [burst, quiet] = data.processes
    expect(burst).toMatchObject({
      processDefinitionKey: "burst",
      processDefinitionName: "BURST",
      latestVersion: 2,
      runningInstances: 30,
      incidentCount: 250,
      scannedIncidentCount: 200,
      affectedActivityCount: null,
      // The scan does not reach back 24h — the burst alone is newer.
      last24hCount: null,
    })
    expect(
      burst.activities.map((a) => [a.activityId, a.scannedIncidentCount, a.firstSeen]),
    ).toEqual([
      ["charge", 150, null],
      ["ship", 50, null],
    ])
    expect(quiet).toMatchObject({
      processDefinitionKey: "quiet",
      incidentCount: 7,
      scannedIncidentCount: 0,
      affectedActivityCount: null,
      latestIncident: null,
      activities: [],
    })
    const scanQuery = requests.find((r) => r.path === "/incident")?.query
    expect(scanQuery).toEqual({ maxResults: "200", sortBy: "incidentTimestamp", sortOrder: "desc" })
    expect(requests.find((r) => r.path === "/process-definition/statistics")?.query).toEqual({
      incidents: "true",
    })
  })

  it("reports exact breakdowns, 24h counts and first-seen when the scan is complete", async () => {
    const scan = [
      row(0, "burst", "charge", HOUR),
      row(1, "burst", "charge", 30 * HOUR),
      row(2, "quiet", "ship", 2 * HOUR),
    ]
    const { data } = await build({
      ...routes(scan, { total: 3, last24h: 2 }),
      "GET /process-definition/statistics": {
        body: [stats("burst", 1, 4, 2), stats("quiet", 1, 1, 1)],
      },
    })

    expect(data.affectedActivityCount).toBe(2)
    expect(
      data.processes.map((p) => [p.processDefinitionKey, p.last24hCount, p.affectedActivityCount]),
    ).toEqual([
      ["burst", 1, 1],
      ["quiet", 1, 1],
    ])
    expect(data.processes[0].activities[0]).toMatchObject({
      activityId: "charge",
      scannedIncidentCount: 2,
      last24hCount: 1,
      firstSeen: scan[1].incidentTimestamp,
      latestIncident: scan[0].incidentTimestamp,
    })
  })

  it("joins scanned rows to their card through the statistics — a long key's id is a bare UUID", async () => {
    // `key:version:uuid` would exceed 64 characters, so the engine stored the
    // bare generated id: nothing in it names the key.
    const key = "customerOnboardingApprovalProcess"
    const uuid = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
    const scan = [0, 1, 2].map((n) => ({
      ...row(n, key, n === 2 ? "review" : "verify", (n + 1) * HOUR),
      processDefinitionId: uuid,
    }))
    const { data } = await build({
      ...routes(scan, { total: 3, last24h: 3 }),
      "GET /process-definition/statistics": {
        body: [
          {
            id: uuid,
            instances: 12,
            incidents: [{ incidentType: "failedJob", incidentCount: 3 }],
            definition: { id: uuid, key, name: "Onboarding", version: 1 },
          },
        ],
      },
    })

    // The scan holds all 3 — the card says so, instead of "0 activities ·
    // +0 last 24h" next to its 3 incidents.
    expect(data.processes).toHaveLength(1)
    expect(data.processes[0]).toMatchObject({
      processDefinitionKey: key,
      incidentCount: 3,
      scannedIncidentCount: 3,
      affectedActivityCount: 2,
      last24hCount: 3,
      latestIncident: scan[0].incidentTimestamp,
    })
    expect(data.affectedActivityCount).toBe(2)
  })

  it("never vouches for a card the complete scan holds none of (attribution gap)", async () => {
    // The statistics list a version the scan rows cannot be joined to: the
    // card keeps its exact count, its scan facts are unknown — not zeros.
    const { data } = await build({
      ...routes([], { total: 0, last24h: 0 }),
      "GET /process-definition/statistics": { body: [stats("late", 1, 2, 4)] },
    })

    expect(data.processes[0]).toMatchObject({
      processDefinitionKey: "late",
      incidentCount: 4,
      scannedIncidentCount: 0,
      affectedActivityCount: null,
      last24hCount: null,
    })
  })

  it("fails on a scope key no version is deployed for — never '0 open incidents'", async () => {
    await expect(
      build(routes([], { total: 0, last24h: 0 }), { processDefinitionKey: "invoce" }),
    ).rejects.toThrow('No process definition with key "invoce" is deployed on this engine.')
  })

  it("narrows every read to the requested key and incident type", async () => {
    const { data, requests } = await build(
      routes([row(0, "quiet", "ship", HOUR)], { total: 7, last24h: 1 }),
      {
        processDefinitionKey: "quiet",
        incidentType: "failedJob",
      },
    )

    expect(data.processes.map((p) => p.processDefinitionKey)).toEqual(["quiet"])
    // Echoed: a standalone render (data only) re-queries and hands off this scope.
    expect(data.filters).toEqual({ processDefinitionKey: "quiet", incidentType: "failedJob" })
    const filter = { processDefinitionKeyIn: "quiet", incidentType: "failedJob" }
    expect(requests.filter((r) => r.path === "/incident/count").map((r) => r.query)).toEqual([
      filter,
      { ...filter, incidentTimestampAfter: expect.any(String) as string },
    ])
    expect(requests.find((r) => r.path === "/incident")?.query).toMatchObject(filter)
    // The statistics count the requested type only (the engine takes one or the other).
    expect(requests.find((r) => r.path === "/process-definition/statistics")?.query).toEqual({
      incidentsForType: "failedJob",
    })
  })
})

// One rule with analytics (`readBpmnNames`): an unnamed process takes its pool name.
describe("buildIncidentsDashboardData — names", () => {
  it("names a card's unnamed process by its Modeler pool, reading only that diagram", async () => {
    const pooled = `<definitions><collaboration id="C"><participant id="Pool" name="Miravelo - Bike Leasing" processRef="quiet"/></collaboration><process id="quiet"/></definitions>`
    const base = routes([], { total: 257, last24h: 0 })
    const { data, requests } = await build({
      ...base,
      "GET /process-definition/statistics": {
        body: [
          stats("burst", 1, 10, 100),
          { ...stats("quiet", 1, 5, 7), definition: { id: "quiet:1:d", key: "quiet", version: 1 } },
        ],
      },
      "GET /process-definition/quiet:1:d/xml": { body: { bpmn20Xml: pooled } },
    })

    expect(data.processes.map((p) => [p.processDefinitionKey, p.processDefinitionName])).toEqual([
      ["burst", "BURST"],
      ["quiet", "Miravelo - Bike Leasing"],
    ])
    expect(requests.filter((r) => r.path.endsWith("/xml")).map((r) => r.path)).toEqual([
      "/process-definition/quiet:1:d/xml",
    ])
  })
})
