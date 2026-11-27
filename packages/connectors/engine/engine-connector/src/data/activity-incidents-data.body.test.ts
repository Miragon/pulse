import { describe, expect, it } from "vitest"
import {
  activityEngine,
  latestDiagram,
  liveCounts,
  queriesOf,
  walk,
} from "./activity-incidents-data.test-support.js"
import {
  closeEnginesAfterEach,
  incidentsAt,
  row,
  V2,
} from "./process-incidents-data.test-support.js"

// Camunda 7 raises a multi-instance activity's own incidents (its failed asynchronous body, say) at
// its body, `<id>#multiInstanceBody`, an id the diagram does not draw (#689 F136). The activity's
// page lists them with its items' incidents, newest first, each under its own id, and its total
// counts them on the activity, as its group on the process route does.

closeEnginesAfterEach()

const BODY = "assess#multiInstanceBody"

/** One list of both, read unbounded: the newer first, then by id. */
function mergedOf(...lists: readonly (readonly ReturnType<typeof row>[])[]): string[] {
  return lists
    .flat()
    .sort(
      (a, b) =>
        Date.parse(b.incidentTimestamp) - Date.parse(a.incidentTimestamp) || (a.id < b.id ? -1 : 1),
    )
    .map((r) => r.id)
}

describe("buildActivityIncidentsData: an activity's page holds its multi-instance body's", () => {
  it("pages the items' and the body's root incidents newest first by one cursor, its total both", async () => {
    // One minute apart, newest first: the body's raised in the 2nd and the 5th.
    const items = [0, 2, 3, 5, 6].map((n) => row(n, "assess", V2))
    const body = [1, 4].map((n) => row(n, BODY, V2))
    const { page, engine } = await activityEngine({
      ...latestDiagram(),
      ...incidentsAt({ assess: items, [BODY]: body }),
    })

    const first = await page({ activityId: "assess", maxResults: 3 })
    const second = await page({ activityId: "assess", maxResults: 3, after: first.next ?? "" })

    // Counted as its group counts them: the key's scan, the body's on the element.
    expect(first.totalCount).toBe(7)
    expect(second.totalCount).toBeNull()
    expect(first.incidents.map((i) => [i.id, i.activityId, i.activityName])).toEqual([
      [items[0].id, "assess", "Assess creditworthiness"],
      [body[0].id, BODY, "Assess creditworthiness"],
      [items[1].id, "assess", "Assess creditworthiness"],
    ])
    // The items go on at their third, the body at its second.
    expect(first.next).toBe("2,1")
    expect(second.incidents.map((i) => i.id)).toEqual([items[2].id, body[1].id, items[3].id])
    expect(second.next).toBe("4,-")
    // Each list asked from its own place for the page and two rows more; the body read to its end.
    expect(
      queriesOf(engine.requests, "/incident").map((q) => [
        q.activityId,
        q.firstResult,
        q.maxResults,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["assess", "0", "5"],
        [BODY, "0", "5"],
        ["assess", "2", "5"],
        [BODY, "1", "5"],
      ]),
    )
    expect(queriesOf(engine.requests, "/incident/count")).toEqual([])
  })

  it("walks a deep list in requests of at most 500 rows, each row of the one merged list once", async () => {
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
    for (const lists of [probe, interleaved]) {
      const { page, engine } = await activityEngine({ ...latestDiagram(), ...incidentsAt(lists) })

      const { ids } = await walk(page, { activityId: "assess", maxResults: 100 })

      expect(ids.flat()).toEqual(mergedOf(lists.assess, lists[BODY]))
      const asked = queriesOf(engine.requests, "/incident").map((q) => Number(q.maxResults))
      expect(Math.max(...asked)).toBeLessThanOrEqual(500)
    }
  })

  it("reads of a large body only the rows a page can hold", async () => {
    // Newest first, one minute apart: 3 at the items among 5000 at the body, which a failed
    // asynchronous body raises once per instance.
    const items = [1, 3, 5].map((n) => row(n, "assess", V2))
    const minutes = Array.from({ length: 5003 }, (_, n) => n).filter((n) => n % 2 === 0 || n > 5)
    const body = minutes.map((n) => row(n, BODY, V2))
    const world = { assess: items, [BODY]: body }
    const { page, engine } = await activityEngine({
      ...latestDiagram(),
      ...liveCounts(V2, world),
      ...incidentsAt(world),
    })

    const first = await page({ activityId: "assess" })

    // Past the key's scan, by the element counts: the body's on the element.
    expect(first.totalCount).toBe(5003)
    expect(first.incidents.map((i) => i.id)).toEqual(mergedOf(items, body).slice(0, 10))
    // Each list asked the page and two rows more, in one request.
    const asked = queriesOf(engine.requests, "/incident")
      .filter((q) => q.activityId !== undefined)
      .map((q) => Number(q.maxResults))
    expect(asked).toEqual([12, 12])
  })

  it("lists a call activity's and its body's root incidents, a copy no row and none of the total", async () => {
    const callBody = "callCheck#multiInstanceBody"
    const copy = {
      ...row(0, "callCheck", V2),
      incidentMessage: null,
      rootCauseIncidentId: "called-0",
    }
    const { page, engine } = await activityEngine({
      ...latestDiagram(),
      ...incidentsAt({
        callCheck: [copy, row(2, "callCheck", V2)],
        [callBody]: [row(1, callBody, V2)],
      }),
    })

    const data = await page({ activityId: "callCheck" })

    expect(data.totalCount).toBe(2)
    expect(data.incidents.map((i) => [i.id, i.activityName])).toEqual([
      [row(1, callBody, V2).id, "Check applicant"],
      [row(2, "callCheck", V2).id, "Check applicant"],
    ])
    // Never counted by the engine at the call activity, whose count holds the copies.
    expect(queriesOf(engine.requests, "/incident/count")).toEqual([])
  })
})
