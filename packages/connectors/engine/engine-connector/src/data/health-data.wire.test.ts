import { afterEach, describe, expect, it } from "vitest"
import { engineDateMillis, toEngineDate } from "@miragon/pulse-c7-core"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { buildClusterDetailData } from "./cluster-detail-data.js"
import { CLUSTER_SCAN_LIMIT } from "./cluster-scan.js"
import { buildEngineHealthData } from "./health-data.js"

// Totals are `/count` or statistics; unvouched cluster counts are null; timestamps order by instant (#335 N71).

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE

const ago = (ageMs: number) => toEngineDate(new Date(Date.now() - ageMs))

// Keyed on the parsed cutoff, so swapping the hour and the 24h window shows.
function windowedCount(counts: { total: number; lastHour: number; last24h: number }) {
  return (r: RecordedRequest) => {
    const cutoff = engineDateMillis(r.query.incidentTimestampAfter)
    if (cutoff === null) return { body: { count: counts.total } }
    return { body: { count: Date.now() - cutoff < 2 * HOUR ? counts.lastHour : counts.last24h } }
  }
}

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

// The DST fall-back hour: textually "02:30+0200" sorts after "02:10+0100",
// but the +0100 stamp is 40 minutes LATER.
const BEFORE_FALL_BACK = "2026-10-25T02:30:00.000+0200"
const AFTER_FALL_BACK = "2026-10-25T02:10:00.000+0100"

const incident = (id: string, incidentTimestamp: string, activityId = "charge") => ({
  id,
  processDefinitionId: "order:2:d2",
  processInstanceId: `pi-${id}`,
  activityId,
  incidentType: "failedJob",
  incidentMessage: "card declined",
  incidentTimestamp,
})

async function engineWith(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes, { body: [] })
  engines.push(engine)
  return { engine, client: clientFor(engine) }
}

describe("buildEngineHealthData: exact totals", () => {
  it("reads the root incidents, the landscape and the verdict from per-key statistics, no /count", async () => {
    const { engine, client } = await engineWith({
      // Newest first, as the engine sorts it.
      "GET /incident": { body: [incident("b", AFTER_FALL_BACK), incident("a", BEFORE_FALL_BACK)] },
      "GET /incident/count": windowedCount({ total: 11, lastHour: 3, last24h: 7 }),
      "GET /process-definition/statistics": {
        body: [
          {
            id: "order:1:d1",
            instances: 38,
            incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
            definition: { id: "order:1:d1", key: "order", version: 1 },
          },
          {
            id: "order:2:d2",
            instances: 61,
            incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
            definition: { id: "order:2:d2", key: "order", version: 2 },
          },
          {
            id: "idle:1:x",
            instances: 4,
            incidents: [],
            definition: { id: "idle:1:x", key: "idle", version: 1 },
          },
        ],
      },
      "GET /history/process-instance/count": { body: { count: 12 } },
    })

    const data = await buildEngineHealthData(client, "fake")

    // The open root incidents are the statistics' (two, of one process), never the 11 every open
    // incident counts, copies included; the last hour is the scan's, which holds every incident
    // (both a month old), never a window /count, which cannot tell a root from a copy.
    expect(data.summary).toEqual({
      totalIncidents: 2,
      lastHourIncidents: 0,
      affectedActivities: 1,
      affectedDefinitions: 1,
      runningInstances: 103,
      totalDefinitions: 2,
      started24h: 12,
      completed24h: 12,
      historyRecorded: true,
    })
    // The verdict judges the same two root incidents: no count of every open incident is read.
    expect(engine.requests.filter((r) => r.path === "/incident/count")).toEqual([])
    expect(data.status).toBe("warning")
    const statistics = engine.requests.filter((r) => r.path === "/process-definition/statistics")
    expect(statistics.map((r) => r.query)).toEqual([{ failedJobs: "true", rootIncidents: "true" }])
    // N71: the cluster's latest incident by instant, not by string.
    expect(data.clusters[0].latestIncident).toBe(AFTER_FALL_BACK)
  })

  it("counts the last hour's root incidents from the scan, copies never, unknown past its reach", async () => {
    const copy = { ...incident("c", ago(5 * MINUTE)), rootCauseIncidentId: "r", activityId: "call" }
    const recent = await engineWith({
      "GET /incident": {
        body: [copy, incident("b", ago(10 * MINUTE)), incident("a", ago(3 * HOUR))],
      },
      "GET /incident/count": { body: { count: 3 } },
    })
    expect((await buildEngineHealthData(recent.client, "fake")).summary.lastHourIncidents).toBe(1)

    // A capped scan all within the last half hour holds only part of the hour.
    const capped = await engineWith({
      "GET /incident": {
        body: Array.from({ length: CLUSTER_SCAN_LIMIT }, (_, n) => incident(`i${n}`, ago(MINUTE))),
      },
      "GET /incident/count": { body: { count: 9000 } },
    })
    expect(
      (await buildEngineHealthData(capped.client, "fake")).summary.lastHourIncidents,
    ).toBeNull()
  })

  it("titles each cluster by its activity's and process's names, ids where unreadable", async () => {
    const xml =
      '<definitions><process id="order" name="Order to cash"><serviceTask id="charge" name="Charge card"/></process></definitions>'
    const { engine, client } = await engineWith({
      "GET /incident": {
        body: [
          incident("a", ago(MINUTE)),
          incident("b", ago(2 * MINUTE)),
          { ...incident("c", ago(3 * MINUTE), "ship"), processDefinitionId: "ship:1:s1" },
        ],
      },
      "GET /incident/count": windowedCount({ total: 3, lastHour: 3, last24h: 3 }),
      "GET /process-definition/statistics": {
        body: [
          {
            id: "order:2:d2",
            instances: 9,
            incidents: [{ incidentType: "failedJob", incidentCount: 2 }],
            definition: { id: "order:2:d2", key: "order", name: "Order to cash", version: 2 },
          },
          {
            id: "ship:1:s1",
            instances: 1,
            incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
            definition: { id: "ship:1:s1", key: "ship", version: 1 },
          },
        ],
      },
      "GET /history/process-instance/count": { body: { count: 0 } },
      "GET /process-definition/order:2:d2/xml": { body: { id: "order:2:d2", bpmn20Xml: xml } },
      "GET /process-definition/ship:1:s1/xml": { status: 500, body: { message: "boom" } },
    })

    const data = await buildEngineHealthData(client, "fake")

    expect(
      data.clusters.map((c) => [c.activityId, c.activityName, c.processDefinitionName]),
    ).toEqual([
      ["charge", "Charge card", "Order to cash"],
      // Its diagram failed and its process has no name: the ids stand in.
      ["ship", null, null],
    ])
    // One diagram per version behind the clusters, never one per incident.
    expect(engine.requests.filter((r) => r.path.endsWith("/xml")).map((r) => r.path)).toEqual([
      "/process-definition/order:2:d2/xml",
      "/process-definition/ship:1:s1/xml",
    ])
  })

  it("reports what a capped scan cannot vouch for as unknown: cluster sizes, the last hour", async () => {
    // A mass failure: the newest 2000 of 5000 incidents, all from the last
    // half hour. The scan reaches back neither to the clusters' start nor 24h.
    const scan = Array.from({ length: CLUSTER_SCAN_LIMIT }, (_, n) =>
      incident(`i${n}`, ago((n * 30 * MINUTE) / CLUSTER_SCAN_LIMIT), `a${n % 3}`),
    )
    const { client } = await engineWith({
      "GET /incident": { body: scan },
      "GET /incident/count": windowedCount({ total: 5000, lastHour: 4000, last24h: 5000 }),
      "GET /history/process-instance/count": { body: { count: 0 } },
    })

    const data = await buildEngineHealthData(client, "fake")

    expect(data.summary.lastHourIncidents).toBeNull()
    expect(data.summary.affectedActivities).toBeNull()
    // The verdict is data (status + counts); each reader words it (#322 U3).
    expect(data.status).toBe("critical")
    expect(data).not.toHaveProperty("headline")
    // The top cluster holds 667 of the SCANNED rows: a lower bound, not its size.
    expect(data.clusters[0]).toMatchObject({
      activityId: "a0",
      incidentCount: null,
      scannedIncidentCount: 667,
    })
  })

  it("keeps a capped scan's cluster a lower bound though the scan reaches back past 24h", async () => {
    // 2000 rows spread over the last 48h: every incident of the last 24h is in it.
    const scan = Array.from({ length: CLUSTER_SCAN_LIMIT }, (_, n) =>
      incident(`i${n}`, ago((n * 48 * HOUR) / CLUSTER_SCAN_LIMIT)),
    )
    const { client } = await engineWith({
      "GET /incident": { body: scan },
      "GET /incident/count": windowedCount({ total: 9000, lastHour: 42, last24h: 1000 }),
      "GET /history/process-instance/count": { body: { count: 0 } },
    })

    const data = await buildEngineHealthData(client, "fake")

    expect(data.clusters[0]).toMatchObject({
      incidentCount: null,
      scannedIncidentCount: CLUSTER_SCAN_LIMIT,
    })
  })

  it("names a long key's cluster by the statistics: its definition id is a bare UUID", async () => {
    const uuid = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
    const { client } = await engineWith({
      "GET /incident": { body: [{ ...incident("a", ago(MINUTE)), processDefinitionId: uuid }] },
      "GET /incident/count": { body: { count: 1 } },
      "GET /process-definition/statistics": {
        body: [
          {
            id: uuid,
            instances: 1,
            incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
            definition: { id: uuid, key: "customerOnboardingApprovalProcess", version: 1 },
          },
        ],
      },
    })

    const data = await buildEngineHealthData(client, "fake")

    expect(data.clusters[0].processDefinitionKeys).toEqual(["customerOnboardingApprovalProcess"])
  })
})

describe("buildClusterDetailData: first/latest by instant (#335 N71)", () => {
  it("orders the cluster's timestamps across a DST fall-back correctly", async () => {
    const { client } = await engineWith({
      "GET /incident": { body: [incident("b", AFTER_FALL_BACK), incident("a", BEFORE_FALL_BACK)] },
    })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "charge",
      incidentType: "failedJob",
    })

    expect(data.firstSeen).toBe(BEFORE_FALL_BACK)
    expect(data.latestIncident).toBe(AFTER_FALL_BACK)
  })
})

describe("buildClusterDetailData: the real definition keys", () => {
  // A key over ~25 characters with UUID ids: the engine stores a bare id,
  // and a key parsed from it is that UUID, which no key filter matches.
  const LONG_KEY = "customerOnboardingApprovalProcess"
  const UUID = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
  const onLongKey = (id: string, ageMs: number) => ({
    ...incident(id, ago(ageMs)),
    processDefinitionId: UUID,
  })

  it("resolves a bare UUID definition id through the statistics (rows and cluster keys)", async () => {
    const { engine, client } = await engineWith({
      "GET /incident": {
        body: [onLongKey("c", MINUTE), onLongKey("b", 2 * MINUTE), incident("a", ago(HOUR))],
      },
      "GET /process-definition/statistics": {
        body: [
          {
            id: UUID,
            instances: 2,
            incidents: [{ incidentType: "failedJob", incidentCount: 2 }],
            definition: { id: UUID, key: LONG_KEY, version: 1 },
          },
        ],
      },
    })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "charge",
      incidentType: "failedJob",
    })

    // The guarded Fix scopes engine_list_jobs by these keys.
    expect(data.processDefinitionKeys).toEqual([LONG_KEY, "order"])
    expect(data.incidents.map((row) => row.processDefinitionKey)).toEqual([
      LONG_KEY,
      LONG_KEY,
      "order",
    ])
    // ONE statistics read for the whole scan.
    expect(engine.requests.filter((r) => r.path === "/process-definition/statistics")).toHaveLength(
      1,
    )
  })

  it("reads no statistics while every definition id names its key", async () => {
    const { engine, client } = await engineWith({
      "GET /incident": { body: [incident("a", ago(MINUTE))] },
    })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "charge",
      incidentType: "failedJob",
    })

    expect(data.processDefinitionKeys).toEqual(["order"])
    // The world's diagram is unreadable here: the ids stand in for the names.
    expect([data.activityName, data.incidents[0].processDefinitionName]).toEqual([null, null])
    // Only the diagram that names the activity (enrichment), never the statistics.
    expect(
      engine.requests.filter((r) => r.path.startsWith("/process-definition")).map((r) => r.path),
    ).toEqual(["/process-definition/order:2:d2/xml"])
  })
})

describe("buildClusterDetailData: names before ids (#322 U13)", () => {
  it("names the activity and each row's process from the diagrams, once per version", async () => {
    const xml =
      '<definitions><process id="order" name="Order to cash"><serviceTask id="charge" name="Charge card"/></process></definitions>'
    const { engine, client } = await engineWith({
      "GET /incident": { body: [incident("a", ago(MINUTE)), incident("b", ago(2 * MINUTE))] },
      "GET /process-instance": { body: [{ id: "pi-a", businessKey: "LEA-1" }] },
      "GET /process-definition/order:2:d2/xml": { body: { id: "order:2:d2", bpmn20Xml: xml } },
    })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "charge",
      incidentType: "failedJob",
    })

    expect(data.activityName).toBe("Charge card")
    expect(data.incidents.map((i) => [i.businessKey, i.processDefinitionName])).toEqual([
      ["LEA-1", "Order to cash"],
      [null, "Order to cash"],
    ])
    expect(engine.requests.filter((r) => r.path.endsWith("/xml"))).toHaveLength(1)
  })
})

// One rule (`readBpmnNames`): Modeler pool names and `&#10;`/`&#38;` read as every view reads them.
describe("names from a Modeler diagram (#322 U13)", () => {
  const MODELER_XML = `<definitions>
  <collaboration id="C"><participant id="Pool" name="Miravelo - Bike Leasing" processRef="order"/></collaboration>
  <process id="order"><serviceTask id="charge" name="Rechnung&#10;prüfen &#38; buchen"/></process>
</definitions>`

  it("titles a health cluster by the decoded activity name and the pool", async () => {
    const { client } = await engineWith({
      "GET /incident": { body: [incident("a", ago(MINUTE))] },
      "GET /incident/count": windowedCount({ total: 1, lastHour: 1, last24h: 1 }),
      "GET /process-definition/statistics": {
        body: [
          {
            id: "order:2:d2",
            instances: 3,
            incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
            definition: { id: "order:2:d2", key: "order", version: 2 },
          },
        ],
      },
      "GET /history/process-instance/count": { body: { count: 0 } },
      "GET /process-definition/order:2:d2/xml": { body: { bpmn20Xml: MODELER_XML } },
    })

    const data = await buildEngineHealthData(client, "fake")

    expect(data.clusters.map((c) => [c.activityName, c.processDefinitionName])).toEqual([
      ["Rechnung prüfen & buchen", "Miravelo - Bike Leasing"],
    ])
  })

  it("names a cluster detail's activity and rows the same way", async () => {
    const { client } = await engineWith({
      "GET /incident": { body: [incident("a", ago(MINUTE))] },
      "GET /process-definition/order:2:d2/xml": { body: { bpmn20Xml: MODELER_XML } },
    })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "charge",
      incidentType: "failedJob",
    })

    expect(data.activityName).toBe("Rechnung prüfen & buchen")
    expect(data.incidents.map((i) => i.processDefinitionName)).toEqual(["Miravelo - Bike Leasing"])
  })
})
