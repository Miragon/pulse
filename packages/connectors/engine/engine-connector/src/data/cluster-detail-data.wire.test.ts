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

// A cluster larger than its scan: its counts come from `/incident/count` only where that count
// can vouch for them (no message filter, no copy of a call activity's), else they are null.

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

const incident = (id: string, incidentTimestamp: string) => ({
  id,
  processDefinitionId: "order:2:d2",
  processInstanceId: `pi-${id}`,
  activityId: "charge",
  incidentType: "failedJob",
  incidentMessage: "card declined",
  incidentTimestamp,
})

async function engineWith(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes, { body: [] })
  engines.push(engine)
  return { engine, client: clientFor(engine) }
}

describe("buildClusterDetailData: a cluster larger than the scan", () => {
  /** The newest 2000 of a mass failure, all from the last half hour; every other one signature B. */
  const massFailure = () =>
    Array.from({ length: CLUSTER_SCAN_LIMIT }, (_, n) => ({
      ...incident(`i${n}`, ago((n * 30 * MINUTE) / CLUSTER_SCAN_LIMIT)),
      incidentMessage: n % 2 ? "card declined" : "gateway timeout",
    }))

  /** The newest root incident's diagram, `charge` a service task there or a call activity. */
  const drawn = (element: "serviceTask" | "callActivity") => ({
    "GET /process-definition/order:2:d2/xml": {
      body: {
        id: "order:2:d2",
        bpmn20Xml: `<definitions><process id="order"><${element} id="charge" name="Charge card"/></process></definitions>`,
      },
    },
  })

  it("takes the cluster's counts from /incident/count without a message filter", async () => {
    const { engine, client } = await engineWith({
      ...drawn("serviceTask"),
      "GET /incident": { body: massFailure() },
      "GET /incident/count": windowedCount({ total: 5000, lastHour: 2400, last24h: 4800 }),
    })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "charge",
      incidentType: "failedJob",
    })

    expect(data).toMatchObject({
      incidentCount: 5000,
      scannedIncidentCount: CLUSTER_SCAN_LIMIT,
      lastHourCount: 2400,
      // The oldest SCANNED row is not when the cluster started.
      firstSeen: null,
      totalMatching: CLUSTER_SCAN_LIMIT,
    })
    const filter = { activityId: "charge", incidentType: "failedJob" }
    const counts = engine.requests.filter((r) => r.path === "/incident/count")
    expect(counts.map((r) => r.query)).toEqual(
      expect.arrayContaining([
        filter,
        { ...filter, incidentTimestampAfter: expect.any(String) as string },
      ]),
    )
    expect(counts).toHaveLength(2)
  })

  it.each([
    ["at a call activity, whose copies /incident/count would count", drawn("callActivity")],
    ["whose diagram cannot tell a call activity", {}],
  ])("reports a cluster's unvouched counts as unknown (null) %s", async (_case, routes) => {
    const { engine, client } = await engineWith({
      ...routes,
      "GET /incident": { body: massFailure() },
      "GET /incident/count": windowedCount({ total: 5000, lastHour: 2400, last24h: 4800 }),
    })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "charge",
      incidentType: "failedJob",
    })

    expect(data).toMatchObject({
      incidentCount: null,
      scannedIncidentCount: CLUSTER_SCAN_LIMIT,
      lastHourCount: null,
    })
    expect(engine.requests.filter((r) => r.path === "/incident/count")).toEqual([])
  })

  it("reports a message-filtered cluster's unvouched counts as unknown (null)", async () => {
    const { engine, client } = await engineWith({
      "GET /incident": { body: massFailure() },
    })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "charge",
      incidentType: "failedJob",
      messageSignature: "card declined",
    })

    expect(data).toMatchObject({
      incidentCount: null,
      scannedIncidentCount: CLUSTER_SCAN_LIMIT / 2,
      lastHourCount: null,
      firstSeen: null,
      totalMatching: CLUSTER_SCAN_LIMIT / 2,
    })
    // /incident/count cannot filter by message: it is not asked.
    expect(engine.requests.filter((r) => r.path === "/incident/count")).toEqual([])
  })

  it("counts a window from the scan once the scan reaches back past it", async () => {
    // 2000 rows over the last 2h: the hour is covered, 24h is not.
    const scan = Array.from({ length: CLUSTER_SCAN_LIMIT }, (_, n) =>
      incident(`i${n}`, ago((n * 2 * HOUR) / CLUSTER_SCAN_LIMIT)),
    )
    const { client } = await engineWith({ "GET /incident": { body: scan } })

    const data = await buildClusterDetailData(client, "fake", {
      activityId: "charge",
      incidentType: "failedJob",
      messageSignature: "card declined",
    })

    expect(data.lastHourCount).toBe(CLUSTER_SCAN_LIMIT / 2)
    expect(data).not.toHaveProperty("last24hCount")
  })
})
