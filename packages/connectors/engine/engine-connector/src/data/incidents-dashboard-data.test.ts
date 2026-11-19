import { afterEach, describe, expect, it } from "vitest"
import { messageSignature, toEngineDate } from "@miragon/pulse-c7-core"
import { cibsevenProvider } from "../providers/index.js"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import type { IncidentsDashboardActivity } from "../view-models.js"
import { buildClusterDetailData } from "./cluster-detail-data.js"
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

describe("buildIncidentsDashboardData: exact cards beyond the scan (#335 N61)", () => {
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
      // The scan does not reach back 24h: the burst alone is newer.
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

    // The scan holds all 3; the card says so, instead of "0 activities ·
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
    // card keeps its exact count, its scan facts are unknown, not zeros.
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

  it("fails on a scope key no version is deployed for, never '0 open incidents'", async () => {
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
    // Echoed: a hand-off states this scope, since a filtered total is not the engine's.
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

// One rule (`readBpmnNames`): an unnamed process takes its pool name.
describe("buildIncidentsDashboardData: names", () => {
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

// N3 step 1, X9: an activity's row is named by its diagram and opens its failure cluster, so it
// carries the cluster's scope (the activity and the incident type; a delegated row's its root
// cause's, below); its failure is in words, a propagated incident's its root cause's, never the
// activity's id again.
describe("buildIncidentsDashboardData: an activity's row", () => {
  const XML = `<definitions><process id="burst"><serviceTask id="charge" name="Charge card"/><callActivity id="billing" name="Run billing"/></process></definitions>`

  const scan = () => {
    const charge = row(1, "burst", "charge", HOUR)
    const custom = { ...row(2, "burst", "charge", 2 * HOUR), incidentType: "custom" }
    const root = { ...row(3, "billing", "debit", 3 * HOUR), incidentMessage: "Debit refused" }
    // The call activity's incident, propagated from the root in the called instance.
    const delegated = {
      ...row(4, "burst", "billing", 3 * HOUR),
      incidentMessage: null,
      rootCauseIncidentId: root.id,
    }
    // Its root lies beyond the scan: no message, and never the id instead.
    const orphan = {
      ...row(5, "burst", "lost", 4 * HOUR),
      incidentMessage: null,
      rootCauseIncidentId: "elsewhere",
    }
    return [charge, custom, root, delegated, orphan]
  }

  async function activities() {
    const { data, requests } = await build({
      "GET /incident": { body: scan() },
      "GET /incident/count": { body: { count: 5 } },
      "GET /process-definition/statistics": {
        body: [stats("burst", 1, 10, 4), stats("billing", 1, 3, 1)],
      },
      "GET /process-definition/burst:1:d/xml": { body: { bpmn20Xml: XML } },
    })
    const burst = data.processes.find((p) => p.processDefinitionKey === "burst")!
    return { burst, requests }
  }

  it("is one per activity and incident type, the scope of the cluster it opens", async () => {
    const { burst } = await activities()
    expect(burst.activities.map((a) => [a.activityId, a.incidentType])).toEqual([
      ["charge", "failedJob"],
      ["charge", "custom"],
      ["billing", "failedJob"],
      ["lost", "failedJob"],
    ])
    // Activities, not their types: charge failing two ways is one of three.
    expect(burst.affectedActivityCount).toBe(3)
  })

  it("is named in the diagram of its newest incident's version, else null (its id shows)", async () => {
    const { burst, requests } = await activities()
    expect(burst.activities.map((a) => a.activityName)).toEqual([
      "Charge card",
      "Charge card",
      "Run billing",
      null,
    ])
    // One diagram per version read, each once (the billing card names its root's activity).
    const diagrams = requests.filter((r) => r.path.endsWith("/xml")).map((r) => r.path)
    expect(diagrams.sort()).toEqual([
      "/process-definition/billing:1:d/xml",
      "/process-definition/burst:1:d/xml",
    ])
  })

  it("says a propagated failure by its root cause where the scan holds it, else nothing", async () => {
    const { burst } = await activities()
    expect(burst.activities.map((a) => a.representativeMessage)).toEqual([
      "charge failed",
      "charge failed",
      "Debit refused",
      null,
    ])
  })
})

// A delegated row's incidents are copies of a called instance's failure, and a cluster is one cause,
// its root incidents alone: the row opens the cause it stands for where the scan holds its root,
// else its process's view; never its own cluster, which answers 0 next to the row's count.
describe("buildIncidentsDashboardData: a delegated row leads to its cause", () => {
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
  // Copies whose roots lie beyond the scan.
  const orphan = (n: number) => ({
    ...row(10 + n, "leasing", "CallLost", 2 * HOUR + n),
    incidentMessage: null,
    rootCauseIncidentId: `beyond-${n}`,
  })
  const INCIDENTS = [copy(0), root(0), copy(1), root(1), copy(2), root(2), orphan(0), orphan(1)]

  /** What a cluster is read by: an activity and a type, a cause's message too. */
  interface ClusterScope {
    activityId: string
    incidentType: string
    messageSignature?: string
  }

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
      "GET /process-definition/statistics": {
        body: [stats("leasing", 1, 5, 5), stats("check", 1, 3, 3)],
      },
    }
  }

  async function dashboard() {
    const engine = await startFakeEngine(world(), { body: [] })
    engines.push(engine)
    const client = clientFor(engine)
    const data = await buildIncidentsDashboardData(client, {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
    })
    const activity = (key: string, activityId: string): IncidentsDashboardActivity =>
      data.processes
        .find((p) => p.processDefinitionKey === key)!
        .activities.find((a) => a.activityId === activityId)!
    /** The cluster a row's scope answers: its own activity and type, or a given cause's. */
    const cluster = (scope: ClusterScope) => buildClusterDetailData(client, "fake", scope)
    return { data, activity, cluster }
  }

  it("names a delegated row's root cause where the scan holds it, whose cluster lists that cause", async () => {
    const { activity, cluster } = await dashboard()
    const assess = activity("leasing", "AssessCredit")
    expect(assess).toMatchObject({
      delegated: true,
      representativeMessage: BLACKLIST,
      scannedIncidentCount: 3,
      rootCause: {
        activityId: "CheckBlacklist",
        incidentType: "failedJob",
        messageSignature: messageSignature(BLACKLIST),
      },
    })

    // The row's own scope holds copies alone: a cluster of none, which the row must never open.
    expect((await cluster(assess)).incidentCount).toBe(0)
    const cause = await cluster(assess.rootCause!)
    expect(cause.incidentCount).toBe(3)
    expect(cause.incidents.map((i) => i.incidentId).sort()).toEqual([
      "check-0",
      "check-1",
      "check-2",
    ])
  })

  it("names no cause for a delegated row whose root lies beyond the scan, which opens its process", async () => {
    const { activity } = await dashboard()
    expect(activity("leasing", "CallLost")).toMatchObject({
      delegated: true,
      representativeMessage: null,
      rootCause: null,
    })
  })

  it("leads every row to a cluster that lists its incidents, or to no cluster at all", async () => {
    const { data, cluster } = await dashboard()
    const rows = data.processes.flatMap((p) => p.activities)
    expect(rows.map((a) => [a.activityId, a.delegated ?? false])).toEqual([
      ["AssessCredit", true],
      ["CallLost", true],
      ["CheckBlacklist", false],
    ])
    // A root's row opens its own cluster, a delegated row its cause's; without one, no cluster.
    const scopes = rows.flatMap((a): ClusterScope[] => {
      if (!a.delegated) return [a]
      return a.rootCause ? [a.rootCause] : []
    })
    const counts = await Promise.all(
      scopes.map(async (scope) => (await cluster(scope)).incidentCount),
    )
    expect(counts).toEqual([3, 3])
  })
})
