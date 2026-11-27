import { BpmnProcessId, ElementId, PageCursor } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { isRootIncident } from "../root-incident.js"
import { type FakePort, fakePort, type Route, turningTies } from "../testing/fake-port.js"
import { ROOT, secondsBefore } from "../testing/incident-search.test-support.js"
import { ElementIncidentSearch } from "./element-incidents.js"

const ASSESS = "Activity_Assess"
const BODY = `${ASSESS}#multiInstanceBody`
const ELEMENT = { bpmnProcessId: BpmnProcessId("order"), elementId: ElementId(ASSESS) }

/** A root incident `id` at `activityId`, raised `seconds` before ROOT. */
function rootAt(activityId: string, id: string, seconds: number) {
  return {
    ...ROOT,
    id,
    activityId,
    rootCauseIncidentId: id,
    incidentTimestamp: secondsBefore(seconds),
  }
}

/** A call activity's copy of the called instance's incident `inc-called`, at `activityId`. */
function copyAt(activityId: string, id: string, seconds: number) {
  return { ...rootAt(activityId, id, seconds), rootCauseIncidentId: "inc-called" }
}

type Row = ReturnType<typeof rootAt>

/** The incidents an engine answers per activity id, each list's ties turned on every request. */
function engineOf(
  byActivity: Readonly<Record<string, readonly { readonly incidentTimestamp: string }[]>>,
): FakePort {
  const routes = new Map(
    Object.entries(byActivity).map(([activityId, rows]) => [
      activityId,
      turningTies(rows, (row) => row.incidentTimestamp),
    ]),
  )
  const getIncidents: Route = (input) => routes.get(input.query.activityId ?? "")?.(input) ?? []
  return fakePort({ getIncidents })
}

/** The root incidents of every list in the page's order: the newer first, then by id. */
function orderOf(...lists: readonly (readonly Row[])[]): string[] {
  return lists
    .flat()
    .filter((row) => isRootIncident(row))
    .sort((left, right) =>
      left.incidentTimestamp === right.incidentTimestamp
        ? left.id.localeCompare(right.id)
        : right.incidentTimestamp.localeCompare(left.incidentTimestamp),
    )
    .map((row) => row.id)
}

/** Every page from the first on, at most 200: the ids of each, and each page's cursor. */
async function walk(port: FakePort, limit: number) {
  const search = new ElementIncidentSearch(port)
  const pages: string[][] = []
  const cursors: (string | undefined)[] = []
  let after: PageCursor | undefined
  do {
    const page = await search.search(ELEMENT, after === undefined ? { limit } : { limit, after })
    pages.push(page.items.map((incident) => incident.id))
    after = page.next
    cursors.push(after)
  } while (after !== undefined && pages.length < 200)
  return { pages, cursors }
}

const activitiesAsked = (port: FakePort) => port.calls.map((call) => call.input.query.activityId)

describe("ElementIncidentSearch.search", () => {
  it("merges the element's and its body's root incidents newest first, each list's cursor its own", async () => {
    const own = [rootAt(ASSESS, "inc-a0", 0), rootAt(ASSESS, "inc-a2", 2)]
    const ofBody = [rootAt(BODY, "inc-b1", 1), rootAt(BODY, "inc-b3", 3)]
    const port = engineOf({ [ASSESS]: own, [BODY]: ofBody })
    const search = new ElementIncidentSearch(port)

    const first = await search.search(ELEMENT, { limit: 3 })

    expect(first.items.map((incident) => [incident.id, incident.activityId])).toStrictEqual([
      ["inc-a0", ASSESS],
      ["inc-b1", BODY],
      ["inc-a2", ASSESS],
    ])
    expect(first.items[0]).toStrictEqual(own[0])
    // The element read to its end, the body from its second incident on.
    expect(first.next).toBe("-,1")
    const second = await search.search(ELEMENT, { limit: 3, after: PageCursor("-,1") })
    expect(second).toStrictEqual({ items: [ofBody[1]] })
    expect(port.calls.map((call) => call.input.query)).toStrictEqual([
      {
        processDefinitionKeyIn: "order",
        activityId: ASSESS,
        sortBy: "incidentTimestamp",
        sortOrder: "desc",
        firstResult: "0",
        maxResults: "5",
      },
      { ...port.calls[0]?.input.query, activityId: BODY },
      { ...port.calls[0]?.input.query, activityId: BODY, firstResult: "1" },
    ])
  })

  it("lists every root incident once, in order, where both lists tie and turn on every request", async () => {
    // Raised in three instants, each a run of rows at the element and at the body, with copies.
    const own = [0, 0, 0, 1, 1, 2, 2, 2, 2].map((seconds, index) =>
      index % 4 === 3
        ? copyAt(ASSESS, `inc-a${index}`, seconds)
        : rootAt(ASSESS, `inc-${index}a`, seconds),
    )
    const ofBody = [0, 0, 1, 2, 2].map((seconds, index) => rootAt(BODY, `inc-${index}b`, seconds))

    for (const limit of [1, 2, 3, 5, 20]) {
      const { pages } = await walk(engineOf({ [ASSESS]: own, [BODY]: ofBody }), limit)

      expect(pages.flat(), `pages of ${limit}`).toStrictEqual(orderOf(own, ofBody))
      expect(pages.slice(0, -1).every((page) => page.length === limit)).toBe(true)
    }
  })

  it("reads the body once where it holds none, and never on a later page", async () => {
    const own = [0, 1, 2, 3, 4].map((seconds) => rootAt(ASSESS, `inc-${seconds}`, seconds))
    const port = engineOf({ [ASSESS]: own })

    const { pages, cursors } = await walk(port, 2)

    expect(pages).toStrictEqual([["inc-0", "inc-1"], ["inc-2", "inc-3"], ["inc-4"]])
    expect(cursors).toStrictEqual(["2,-", "4,-", undefined])
    expect(activitiesAsked(port)).toStrictEqual([ASSESS, BODY, ASSESS, ASSESS])
  })

  it("drops a copy and an incident without its instance or version, and fills the page", async () => {
    const own = [
      copyAt(ASSESS, "inc-copy", 0),
      { ...rootAt(ASSESS, "inc-no-instance", 1), processInstanceId: undefined },
      { ...rootAt(ASSESS, "inc-no-version", 2), processDefinitionId: undefined },
      { ...rootAt(ASSESS, "inc-no-element", 3), activityId: undefined },
      rootAt(ASSESS, "inc-kept", 4),
    ]
    const port = engineOf({ [ASSESS]: own })

    const page = await new ElementIncidentSearch(port).search(ELEMENT, { limit: 1 })

    expect(page).toStrictEqual({ items: [own[4]] })
    expect(port.calls.map((call) => call.input.query.maxResults)).toStrictEqual(["3", "3", "6"])
  })

  it("ends a page before the incidents of a list whose page stopped at its bound, and goes on there", async () => {
    // 4,000 copies at the element raised before its one root incident: its page stops at the
    // bound of 10 requests with none kept, while the body's page is full.
    const copies = Array.from({ length: 4000 }, (_, index) =>
      copyAt(ASSESS, `inc-c${String(index).padStart(4, "0")}`, 10 + index),
    )
    const own = [rootAt(ASSESS, "inc-a", 5), ...copies, rootAt(ASSESS, "inc-z", 9000)]
    const ofBody = [6, 7, 8, 5000, 9500].map((seconds) => rootAt(BODY, `inc-b${seconds}`, seconds))
    const port = engineOf({ [ASSESS]: own, [BODY]: ofBody })

    const { pages, cursors } = await walk(port, 2)

    expect(pages.flat()).toStrictEqual(orderOf(own, ofBody))
    // The element's pages stop inside its copies: each merged page ends before the body's older
    // incidents, the body's place kept at its first.
    expect(pages.slice(0, 3)).toStrictEqual([["inc-a"], [], ["inc-b6", "inc-b7"]])
    expect(cursors.slice(0, 2)).toStrictEqual(["1998,0", "3996,0"])
  })

  it.each(["x", "1", "1,2,3", "1,x", ",1", "1.2.3,-", ""])(
    "fails the cursor %j as no cursor of this paging, before anything is read",
    async (after) => {
      const port = engineOf({})

      await expect(
        new ElementIncidentSearch(port).search(ELEMENT, { limit: 5, after: PageCursor(after) }),
      ).rejects.toThrow(new RangeError(`"${after}" is not a page cursor of this engine`))
      expect(port.calls).toStrictEqual([])
    },
  )

  it("reads nothing past both lists' ends", async () => {
    const port = engineOf({})

    const page = await new ElementIncidentSearch(port).search(ELEMENT, {
      limit: 5,
      after: PageCursor("-,-"),
    })

    expect(page).toStrictEqual({ items: [] })
    expect(port.calls).toStrictEqual([])
  })
})
