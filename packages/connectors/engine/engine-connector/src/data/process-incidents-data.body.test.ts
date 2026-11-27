import { describe, expect, it } from "vitest"
import { cibsevenProvider } from "../providers/index.js"
import {
  clientFor,
  startFakeEngine,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import { buildActivityIncidentsData } from "./process-incidents-data.js"
import {
  at,
  atActivity,
  build,
  closeEnginesAfterEach,
  definitionRoutes,
  diagram,
  engines,
  incidentsAt,
  KEY,
  row,
  V2,
} from "./process-incidents-data.test-support.js"

// Camunda 7 raises a multi-instance activity's own incidents (its failed asynchronous body, say) at
// its body, `<id>#multiInstanceBody`, an id the diagram does not draw (#689 F136). The process view
// groups them on the activity, as its Running and the element statistics count them, and the
// activity's page lists them with its items' incidents, newest first, each under its own id.

closeEnginesAfterEach()

const BODY = "assess#multiInstanceBody"

const queriesOf = (requests: RecordedRequest[], path: string) =>
  requests.filter((r) => r.path === path).map((r) => r.query)

describe("buildProcessIncidentsData: a multi-instance body's root incidents on its activity", () => {
  it("groups a complete scan's body incident with its activity's, one activity of the diagram", async () => {
    const scan = [row(0, "assess", V2), row(1, BODY, V2)]
    const { data } = await build(definitionRoutes(scan, 2))

    expect(data.activities.map((a) => [a.activityId, a.activityName, a.incidentCount])).toEqual([
      ["assess", "Assess creditworthiness", 2],
    ])
    expect(data.affectedDiagramActivityCount).toBe(1)
    expect(data.totalActivityCount).toBe(2)
    // The group's facts hold the body's incident too: the scan holds the whole group.
    expect(data.activities[0]).toMatchObject({
      representativeMessage: "assess failed",
      latestIncident: scan[0].incidentTimestamp,
      firstSeen: scan[1].incidentTimestamp,
    })
  })

  it("takes a capped scan's rows of the body onto its activity, its count from the statistics", async () => {
    // The scan's 200 rows, its limit: the body's incident the newest, then sendPolicy's.
    const sendPolicy = Array.from({ length: 250 }, (_, n) => row(n + 1, "sendPolicy", V2))
    const scan = [row(0, BODY, V2), ...sendPolicy.slice(0, 199)]
    const byVersion = { [V2]: [row(0, BODY, V2), row(300, "assess", V2), ...sendPolicy] }
    const { data } = await build({
      ...definitionRoutes(scan, 252),
      "GET /incident": (r: RecordedRequest) => ({
        body: r.query.processDefinitionId ? atActivity(byVersion, r.query) : scan,
      }),
      [`GET /process-definition/${V2}/xml`]: diagram(
        V2,
        '<serviceTask id="assess" name="Assess creditworthiness"/><serviceTask id="sendPolicy"/>',
      ),
      [`GET /process-definition/${V2}/statistics`]: {
        body: [at("assess", 1), at(BODY, 1), at("sendPolicy", 250)],
      },
    })

    expect(
      data.activities.map((a) => [a.activityId, a.incidentCount, a.representativeMessage]),
    ).toEqual([
      ["sendPolicy", 250, "sendPolicy failed"],
      ["assess", 2, `${BODY} failed`],
    ])
    expect(data.activities[1]).toMatchObject({
      latestIncident: scan[0].incidentTimestamp,
      firstSeen: null,
    })
    expect(data.affectedDiagramActivityCount).toBe(2)
  })
})

describe("buildActivityIncidentsData: an activity's page holds its multi-instance body's", () => {
  const XML =
    '<definitions><process id="leasing"><serviceTask id="assess" name="Assess creditworthiness"/><callActivity id="callCheck" name="Check applicant"/></process></definitions>'

  async function page(
    byActivity: Record<string, readonly unknown[]>,
    target: { activityId: string; firstResult?: number; maxResults?: number },
  ) {
    const engine = await startFakeEngine({
      "GET /process-definition": { body: [{ id: V2, key: KEY, name: "Leasing", version: 2 }] },
      [`GET /process-definition/${V2}/xml`]: { body: { id: V2, bpmn20Xml: XML } },
      ...incidentsAt(byActivity),
    })
    engines.push(engine)
    const data = await buildActivityIncidentsData(clientFor(engine), {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
      processDefinitionKey: KEY,
      ...target,
    })
    return { data, requests: engine.requests }
  }

  it("pages the items' and the body's root incidents newest first, their totals summed", async () => {
    // One minute apart, newest first: the body's raised in the 2nd and the 5th.
    const items = [0, 2, 3, 5, 6].map((n) => row(n, "assess", V2))
    const body = [1, 4].map((n) => row(n, BODY, V2))

    const { data, requests } = await page(
      { assess: items, [BODY]: body },
      { activityId: "assess", firstResult: 1, maxResults: 3 },
    )

    expect(data.totalCount).toBe(7)
    expect(data.incidents.map((i) => [i.id, i.activityId, i.activityName])).toEqual([
      [body[0].id, BODY, "Assess creditworthiness"],
      [items[1].id, "assess", "Assess creditworthiness"],
      [items[2].id, "assess", "Assess creditworthiness"],
    ])
    // The body counted once, to tell whether it holds an incident, and read from its first row to
    // the page's end, whole here; the items paged by the engine from as many rows before the page
    // as the body counts (none here) to the page's end, and counted there.
    const paged = queriesOf(requests, "/incident").map((q) => [
      q.activityId,
      q.firstResult,
      q.maxResults,
    ])
    expect(paged).toHaveLength(2)
    expect(paged).toEqual(
      expect.arrayContaining([
        ["assess", "0", "4"],
        [BODY, "0", "2"],
      ]),
    )
    const counted = queriesOf(requests, "/incident/count").map((q) => q.activityId)
    expect(counted.sort()).toEqual(["assess", BODY])
  })

  it("reads a deep page in requests of at most 500 rows, the rows of one merged list", async () => {
    // Newest first, one minute apart: the review's probe, 700 at the items and one at the body tied
    // with the 606th; and a body of 600 between 1200 items, each list more than one request.
    const probe = {
      assess: Array.from({ length: 700 }, (_, n) => row(n, "assess", V2)),
      [BODY]: [row(605, BODY, V2)],
    }
    const minutes = Array.from({ length: 1800 }, (_, n) => n)
    const interleaved = {
      assess: minutes.filter((n) => n % 3 !== 1).map((n) => row(n, "assess", V2)),
      [BODY]: minutes.filter((n) => n % 3 === 1).map((n) => row(n, BODY, V2)),
    }
    const cases = [
      { lists: probe, firstResults: [600] },
      { lists: interleaved, firstResults: [0, 600, 1195, 1795, 1800] },
    ]
    for (const { lists, firstResults } of cases) {
      // One list, both read unbounded: the newer first, the item first on a tie.
      const merged = [...lists.assess, ...lists[BODY]].sort(
        (a, b) => Date.parse(b.incidentTimestamp) - Date.parse(a.incidentTimestamp),
      )
      for (const firstResult of firstResults) {
        const { data, requests } = await page(lists, { activityId: "assess", firstResult })

        expect(data.totalCount).toBe(merged.length)
        expect(data.incidents.map((i) => i.id)).toEqual(
          merged.slice(firstResult, firstResult + 10).map((r) => r.id),
        )
        const asked = queriesOf(requests, "/incident").map((q) => Number(q.maxResults))
        expect(Math.max(...asked)).toBeLessThanOrEqual(500)
        const counted = queriesOf(requests, "/incident/count").map((q) => q.activityId)
        expect(counted.sort()).toEqual(["assess", BODY])
      }
    }
  })

  it("reads of a large body only the rows a shallow page can hold", async () => {
    // Newest first, one minute apart: 3 at the items among 5000 at the body, which a failed
    // asynchronous body raises once per instance.
    const items = [1, 3, 5].map((n) => row(n, "assess", V2))
    const minutes = Array.from({ length: 5003 }, (_, n) => n).filter((n) => n % 2 === 0 || n > 5)
    const lists = { assess: items, [BODY]: minutes.map((n) => row(n, BODY, V2)) }
    const merged = [...items, ...lists[BODY]].sort(
      (a, b) => Date.parse(b.incidentTimestamp) - Date.parse(a.incidentTimestamp),
    )

    for (const firstResult of [0, 20]) {
      const { data, requests } = await page(lists, { activityId: "assess", firstResult })

      expect(data.totalCount).toBe(5003)
      expect(data.incidents.map((i) => i.id)).toEqual(
        merged.slice(firstResult, firstResult + 10).map((r) => r.id),
      )
      // Each list asked at most the page's end, in one request; the body counted once.
      const asked = queriesOf(requests, "/incident").map((q) => Number(q.maxResults))
      expect(asked).toHaveLength(2)
      expect(Math.max(...asked)).toBeLessThanOrEqual(firstResult + 10)
      const counted = queriesOf(requests, "/incident/count").map((q) => q.activityId)
      expect(counted.sort()).toEqual(["assess", BODY])
    }
  })

  it("reads a call activity's and its body's incidents whole, a copy no row", async () => {
    const callBody = "callCheck#multiInstanceBody"
    const copy = {
      ...row(0, "callCheck", V2),
      incidentMessage: null,
      rootCauseIncidentId: "called-0",
    }

    const { data, requests } = await page(
      { callCheck: [copy, row(2, "callCheck", V2)], [callBody]: [row(1, callBody, V2)] },
      { activityId: "callCheck" },
    )

    expect(data.totalCount).toBe(2)
    expect(data.incidents.map((i) => [i.id, i.activityName])).toEqual([
      [row(1, callBody, V2).id, "Check applicant"],
      [row(2, "callCheck", V2).id, "Check applicant"],
    ])
    // Whole, never counted at the call activity, whose count holds the copies.
    expect(queriesOf(requests, "/incident/count").map((q) => q.activityId)).toEqual([callBody])
  })
})
