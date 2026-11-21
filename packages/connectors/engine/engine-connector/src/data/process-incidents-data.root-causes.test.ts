import { describe, expect, it } from "vitest"
import { cibsevenProvider } from "../providers/index.js"
import { clientFor, startFakeEngine, type FakeRoutes } from "../tools/test-support/fake-engine.js"
import { buildActivityIncidentsData } from "./process-incidents-data.js"
import {
  build,
  closeEnginesAfterEach,
  definitionRoutes,
  engines,
  KEY,
  row,
  V1,
  V2,
} from "./process-incidents-data.test-support.js"

// A call activity's incidents are copies of its called instances' incidents: no message of their
// own, their root cause in the called instance. A process counts its root incidents alone, so its
// activity groups hold none, and an activity's page lists a call activity's own root incidents
// alone (the copies count in the called process).

closeEnginesAfterEach()

describe("buildProcessIncidentsData: a call activity's copies are no group of its own", () => {
  const copy = (n: number, root: string) => ({
    ...row(n, "assess", V2),
    incidentMessage: null,
    configuration: null,
    rootCauseIncidentId: root,
  })
  const scan = [copy(0, "root-a"), copy(1, "root-b"), row(2, "sendPolicy", V2)]

  it("counts and lists its own root incidents alone, reading no root of a copy", async () => {
    // The statistics' root incidents: sendPolicy's one; the copies count in the called process.
    const { data, requests } = await build(definitionRoutes(scan, 1))

    expect(data.incidentCount).toBe(1)
    expect(
      data.activities.map((a) => [a.activityId, a.incidentCount, a.representativeMessage]),
    ).toEqual([["sendPolicy", 1, "sendPolicy failed"]])
    expect(data.latestIncident).toBe(scan[2]?.incidentTimestamp)
    expect(requests.filter((r) => r.path.startsWith("/incident/root"))).toEqual([])
  })
})

describe("buildActivityIncidentsData: a call activity's copies are no row of its page", () => {
  const CALLER_XML =
    '<definitions><process id="leasing"><callActivity id="callCheck" name="Check applicant"/></process></definitions>'
  const copy = (n: number, root: string) => ({
    ...row(n, "callCheck", V1),
    incidentMessage: null,
    configuration: null,
    rootCauseIncidentId: root,
  })

  async function page(routes: FakeRoutes) {
    const engine = await startFakeEngine(
      {
        "GET /process-definition": {
          body: [{ id: V2, key: KEY, name: "Leasing", version: 2 }],
        },
        [`GET /process-definition/${V2}/xml`]: { body: { id: V2, bpmn20Xml: CALLER_XML } },
        "GET /incident/count": { body: { count: 4 } },
        ...routes,
      },
      { body: [] },
    )
    engines.push(engine)
    const data = await buildActivityIncidentsData(clientFor(engine), {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
      processDefinitionKey: KEY,
      activityId: "callCheck",
    })
    return { data, requests: engine.requests }
  }

  it("lists its own root incident alone, as its group counts it, reading no root of a copy", async () => {
    const { data, requests } = await page({
      "GET /incident": {
        body: [copy(0, "root-a"), copy(1, "root-a"), copy(2, "root-b"), row(3, "callCheck", V1)],
      },
    })

    expect(data.totalCount).toBe(1)
    expect(data.incidents.map((i) => [i.id, i.activityName, i.rootCause ?? null])).toEqual([
      [row(3, "callCheck", V1).id, "Check applicant", null],
    ])
    expect(requests.filter((r) => r.path.startsWith("/incident/root"))).toEqual([])
    expect(requests.filter((r) => r.path === "/incident/count")).toEqual([])
  })

  it("has no row where the call activity holds copies alone", async () => {
    const { data } = await page({ "GET /incident": { body: [copy(0, "root-a")] } })
    expect(data).toMatchObject({ totalCount: 0, incidents: [] })
  })
})
