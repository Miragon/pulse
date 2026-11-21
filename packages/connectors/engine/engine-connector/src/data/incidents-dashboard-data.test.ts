import { afterEach, describe, expect, it } from "vitest"
import { toEngineDate } from "@miragon/pulse-c7-core"
import { cibsevenProvider } from "../providers/index.js"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import { buildIncidentsDashboardData } from "./incidents-dashboard-data.js"

// #335 N61: a burst on one process must not push another off the overview. Its counts are open
// root incidents (owner decision D2, amended on 2026-11-19): the statistics with
// `rootIncidents=true`, a call activity's copy of a called instance's incident never a row.

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

function routes(scan: unknown[]): FakeRoutes {
  return {
    "GET /incident": { body: scan },
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

describe("buildIncidentsDashboardData: exact cards beyond the scan (#335 N61)", () => {
  it("keeps a process whose incidents all lie beyond the 200-row scan, with its exact count", async () => {
    // 257 open incidents: a 250-incident burst in the last minutes fills the
    // whole scan; quiet's 7 older incidents are all beyond it.
    const scan = Array.from({ length: 200 }, (_, n) =>
      row(n, "burst", n % 4 ? "charge" : "ship", n * 1000),
    )
    const { data, requests } = await build(routes(scan))

    expect(data).toMatchObject({
      totalCount: 257,
      processCount: 2,
      // Neither card's breakdown is complete: unknown, not a sum of scans.
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
      rootIncidents: "true",
    })
    // The total is the cards' sum: no /count, which counts a call activity's copies too.
    expect(requests.some((r) => r.path === "/incident/count")).toBe(false)
  })

  it("reports exact breakdowns and first-seen when the scan is complete", async () => {
    const scan = [
      row(0, "burst", "charge", HOUR),
      row(1, "burst", "charge", 30 * HOUR),
      row(2, "quiet", "ship", 2 * HOUR),
    ]
    const { data } = await build({
      ...routes(scan),
      "GET /process-definition/statistics": {
        body: [stats("burst", 1, 4, 2), stats("quiet", 1, 1, 1)],
      },
    })

    expect(data.affectedActivityCount).toBe(2)
    expect(data.processes.map((p) => [p.processDefinitionKey, p.affectedActivityCount])).toEqual([
      ["burst", 1],
      ["quiet", 1],
    ])
    expect(data.processes[0].activities[0]).toMatchObject({
      activityId: "charge",
      scannedIncidentCount: 2,
      firstSeen: scan[1].incidentTimestamp,
      latestIncident: scan[0].incidentTimestamp,
    })
  })

  it("joins scanned rows to their card through the statistics: a long key's id is a bare UUID", async () => {
    // `key:version:uuid` would exceed 64 characters, so the engine stored the
    // bare generated id: nothing in it names the key.
    const key = "customerOnboardingApprovalProcess"
    const uuid = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
    const scan = [0, 1, 2].map((n) => ({
      ...row(n, key, n === 2 ? "review" : "verify", (n + 1) * HOUR),
      processDefinitionId: uuid,
    }))
    const { data } = await build({
      ...routes(scan),
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

    // The scan holds all 3; the card says so, instead of "0 activities ·
    // +0 last 24h" next to its 3 incidents.
    expect(data.processes).toHaveLength(1)
    expect(data.processes[0]).toMatchObject({
      processDefinitionKey: key,
      incidentCount: 3,
      scannedIncidentCount: 3,
      affectedActivityCount: 2,
      latestIncident: scan[0].incidentTimestamp,
    })
    expect(data.affectedActivityCount).toBe(2)
  })

  it("never vouches for a card the complete scan holds none of (attribution gap)", async () => {
    // The statistics list a version the scan rows cannot be joined to: the
    // card keeps its exact count, its scan facts are unknown, not zeros.
    const { data } = await build({
      ...routes([]),
      "GET /process-definition/statistics": { body: [stats("late", 1, 2, 4)] },
    })

    expect(data.processes[0]).toMatchObject({
      processDefinitionKey: "late",
      incidentCount: 4,
      scannedIncidentCount: 0,
      affectedActivityCount: null,
    })
  })

  it("fails on a scope key no version is deployed for, never '0 open incidents'", async () => {
    await expect(build(routes([]), { processDefinitionKey: "invoce" })).rejects.toThrow(
      'No process definition with key "invoce" is deployed on this engine.',
    )
  })

  it("narrows every read to the requested key and incident type", async () => {
    const { data, requests } = await build(
      {
        ...routes([row(0, "quiet", "ship", HOUR)]),
        "GET /process-definition/statistics": {
          body: [
            {
              ...stats("quiet", 1, 5, 7),
              incidents: [
                { incidentType: "failedJob", incidentCount: 7 },
                { incidentType: "custom", incidentCount: 2 },
              ],
            },
            stats("burst", 1, 10, 100),
          ],
        },
      },
      {
        processDefinitionKey: "quiet",
        incidentType: "failedJob",
      },
    )

    expect(data.processes.map((p) => p.processDefinitionKey)).toEqual(["quiet"])
    // The requested type alone: the engine counts root incidents per type, the view picks one.
    expect(data.totalCount).toBe(7)
    expect(data.processes[0]?.incidentCount).toBe(7)
    // Echoed: a hand-off states this scope, since a filtered total is not the engine's.
    expect(data.filters).toEqual({ processDefinitionKey: "quiet", incidentType: "failedJob" })
    const filter = { processDefinitionKeyIn: "quiet", incidentType: "failedJob" }
    expect(requests.find((r) => r.path === "/incident")?.query).toMatchObject(filter)
    // `rootIncidents=true` takes no type of its own (nor `incidentsForType` beside it).
    expect(requests.find((r) => r.path === "/process-definition/statistics")?.query).toEqual({
      rootIncidents: "true",
    })
  })
})

// One rule (`readBpmnNames`): an unnamed process takes its pool name.
describe("buildIncidentsDashboardData: names", () => {
  it("names a card's unnamed process by its Modeler pool, reading only that diagram", async () => {
    const pooled = `<definitions><collaboration id="C"><participant id="Pool" name="Miravelo - Bike Leasing" processRef="quiet"/></collaboration><process id="quiet"/></definitions>`
    const base = routes([])
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

// N3 step 1, X9: an activity's row is named by its diagram and opens its failure cluster, so it
// carries the cluster's scope (the activity and the incident type); its failure is in words, never
// the activity's id again. A call activity's copies of its called instances' incidents are no row:
// their root incidents are the called process's.
describe("buildIncidentsDashboardData: an activity's row", () => {
  const XML = `<definitions><process id="burst"><serviceTask id="charge" name="Charge card"/><callActivity id="billing" name="Run billing"/></process></definitions>`

  const scan = () => {
    const charge = row(1, "burst", "charge", HOUR)
    const custom = { ...row(2, "burst", "charge", 2 * HOUR), incidentType: "custom" }
    const root = { ...row(3, "billing", "debit", 3 * HOUR), incidentMessage: "Debit refused" }
    // The call activity's incident, copied from the root in the called instance.
    const copy = {
      ...row(4, "burst", "billing", 3 * HOUR),
      incidentMessage: null,
      rootCauseIncidentId: root.id,
    }
    // A copy whose root lies beyond the scan.
    const orphan = {
      ...row(5, "burst", "lost", 4 * HOUR),
      incidentMessage: null,
      rootCauseIncidentId: "elsewhere",
    }
    return [charge, custom, root, copy, orphan]
  }

  async function dashboard() {
    const { data, requests } = await build({
      "GET /incident": { body: scan() },
      // The root incidents: burst's two at charge, billing's one; never the copies.
      "GET /process-definition/statistics": {
        body: [stats("burst", 1, 10, 2), stats("billing", 1, 3, 1)],
      },
      "GET /process-definition/burst:1:d/xml": { body: { bpmn20Xml: XML } },
    })
    const burst = data.processes.find((p) => p.processDefinitionKey === "burst")!
    return { data, burst, requests }
  }

  it("is one per activity and incident type of its root incidents, the scope of the cluster it opens", async () => {
    const { burst } = await dashboard()
    expect(burst.activities.map((a) => [a.activityId, a.incidentType])).toEqual([
      ["charge", "failedJob"],
      ["charge", "custom"],
    ])
    // Activities, not their types: charge failing two ways is one; the copies are none.
    expect(burst.affectedActivityCount).toBe(1)
  })

  it("leaves a call activity's copies to the called process, whose card holds their root", async () => {
    const { data } = await dashboard()
    expect(data.totalCount).toBe(3)
    expect(
      data.processes.map((p) => [
        p.processDefinitionKey,
        p.incidentCount,
        p.activities.map((a) => [a.activityId, a.scannedIncidentCount]),
      ]),
    ).toEqual([
      [
        "burst",
        2,
        [
          ["charge", 1],
          ["charge", 1],
        ],
      ],
      ["billing", 1, [["debit", 1]]],
    ])
  })

  it("is named in the diagram of its newest incident's version, else null (its id shows)", async () => {
    const { burst, requests } = await dashboard()
    expect(burst.activities.map((a) => a.activityName)).toEqual(["Charge card", "Charge card"])
    // One diagram per version read, each once.
    const diagrams = requests.filter((r) => r.path.endsWith("/xml")).map((r) => r.path)
    expect(diagrams.sort()).toEqual([
      "/process-definition/billing:1:d/xml",
      "/process-definition/burst:1:d/xml",
    ])
  })

  it("says its failure in the engine's words", async () => {
    const { data, burst } = await dashboard()
    expect(burst.activities.map((a) => a.representativeMessage)).toEqual([
      "charge failed",
      "charge failed",
    ])
    expect(data.processes[1]?.activities[0]?.representativeMessage).toBe("Debit refused")
  })
})

// A copy of a called instance's failure is that failure, and a cluster is one cause, its root
// incidents alone: a caller whose call activity holds only copies has no card, and the called
// process's row opens the cluster that lists every root incident it counts.
describe("buildIncidentsDashboardData: a call chain counts its root incidents once", () => {
  const BLACKLIST = "Blacklist provider unreachable"
  const root = (n: number) => ({
    ...row(n, "check", "CheckBlacklist", HOUR + n),
    incidentMessage: BLACKLIST,
    rootCauseIncidentId: `check-${n}`,
  })
  // Each root's copy at the caller's call activity, newer than the root by nothing.
  const copy = (n: number) => ({
    ...row(n, "leasing", "AssessCredit", HOUR + n),
    incidentMessage: null,
    rootCauseIncidentId: `check-${n}`,
  })
  const INCIDENTS = [copy(0), root(0), copy(1), root(1), copy(2), root(2)]

  /** The engine filters `/incident` and its count by the activity and the type, as a cluster reads. */
  function world(): FakeRoutes {
    const matching = (r: RecordedRequest) =>
      INCIDENTS.filter(
        (i) =>
          (!r.query.activityId || i.activityId === r.query.activityId) &&
          (!r.query.incidentType || i.incidentType === r.query.incidentType),
      )
    return {
      "GET /incident": (r: RecordedRequest) => ({ body: matching(r) }),
      "GET /incident/count": (r: RecordedRequest) => ({ body: { count: matching(r).length } }),
      // `rootIncidents=true`: the called process's three; `incidents=true` would count the copies
      // at leasing too.
      "GET /process-definition/statistics": (r: RecordedRequest) => ({
        body: [
          stats("leasing", 1, 5, r.query.rootIncidents === "true" ? 0 : 3),
          stats("check", 1, 3, 3),
        ],
      }),
    }
  }

  it("names the called process's root incidents once, whose cluster lists each", async () => {
    const engine = await startFakeEngine(world(), { body: [] })
    engines.push(engine)
    const client = clientFor(engine)
    const data = await buildIncidentsDashboardData(client, {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
    })

    // Three open incidents, not six; the caller, whose call activity holds the copies, no card.
    expect(data.totalCount).toBe(3)
    expect(data.processes.map((p) => p.processDefinitionKey)).toEqual(["check"])
    const [row] = data.processes[0]?.activities ?? []
    expect(row).toMatchObject({
      activityId: "CheckBlacklist",
      representativeMessage: BLACKLIST,
      scannedIncidentCount: 3,
    })
    const cause = await buildClusterDetailData(client, "fake", {
      activityId: row.activityId,
      incidentType: row.incidentType,
    })
    expect(cause.incidentCount).toBe(3)
    expect(cause.incidents.map((i) => i.incidentId).sort()).toEqual([
      "check-0",
      "check-1",
      "check-2",
    ])
  })
})
