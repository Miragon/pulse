import { describe, expect, it } from "vitest"
import {
  activityEngine,
  groupCountOf,
  latestDiagram,
  liveCounts,
  pageOn,
  queriesOf,
  ROUTE_COUNTS,
  turningIncidentsAt,
  walk,
} from "./activity-incidents-data.test-support.js"
import { readElementCounts } from "./element-counts.js"
import { INCIDENT_SCAN_LIMIT } from "./engine-reads.js"
import {
  closeEnginesAfterEach,
  incidentsAt,
  KEY,
  row,
  V1,
  V2,
} from "./process-incidents-data.test-support.js"

closeEnginesAfterEach()

/** A call activity's copy of the called instance's incident `called-<n>`: no message of its own. */
const copyAt = (n: number, activityId: string, definitionId: string) => ({
  ...row(n, activityId, definitionId),
  incidentMessage: null,
  configuration: null,
  rootCauseIncidentId: `called-${n}`,
})

/** A root incident raised at the same instant as the row `at` of the same activity. */
const tiedWith = (n: number, at: number, activityId: string) => ({
  ...row(n, activityId, V1),
  incidentTimestamp: row(at, activityId, V1).incidentTimestamp,
})

describe("buildActivityIncidentsData: a page of an activity's root incidents by its cursor (N67, #690)", () => {
  it("reads a later page by its cursor, no total, and links each row to its own version", async () => {
    const { data, requests } = await pageOn(
      {
        ...latestDiagram(),
        // The page the engine answers at the activity, wherever it starts; none at its body.
        "GET /incident": (r) => ({
          body: r.query.activityId === "assess" ? [row(0, "assess", V1)] : [],
        }),
      },
      { activityId: "assess", after: "10,0" },
    )

    // The list keeps its first page's total.
    expect(data.totalCount).toBeNull()
    expect(data.next).toBeNull()
    // The cockpit route of the row's OWN version (v1), not the latest.
    expect(data.incidents[0].cockpitInstanceUrl).toContain(`/process/${KEY}/1/pi-assess-0`)
    const newest = { processDefinitionKeyIn: KEY, sortBy: "incidentTimestamp", sortOrder: "desc" }
    expect(queriesOf(requests, "/incident")).toEqual(
      expect.arrayContaining([
        { ...newest, activityId: "assess", firstResult: "10", maxResults: "12" },
        { ...newest, activityId: "assess#multiInstanceBody", firstResult: "0", maxResults: "12" },
      ]),
    )
    // No statistics, scan or count per page: the key's latest diagram (which names the element),
    // the element's page and its body's, and the page's business keys, ONE read (#322 U13).
    expect(requests.map((r) => r.path).sort()).toEqual([
      "/incident",
      "/incident",
      "/process-definition",
      `/process-definition/${V2}/xml`,
      "/process-instance",
    ])
    expect(data.incidents[0].activityName).toBe("Assess creditworthiness")
  })

  it("pages each root incident once, newest first and then by id, where the engine orders ties anew", async () => {
    // 14 incidents in four instants, the ties in a scrambled order of their ids.
    const rows = [
      row(0, "assess", V1),
      ...[5, 3, 9, 1, 7].map((n) => tiedWith(n, 1, "assess")),
      ...[12, 10, 11].map((n) => tiedWith(n, 2, "assess")),
      ...[4, 8, 2, 6].map((n) => tiedWith(n, 3, "assess")),
      row(13, "assess", V1),
    ]
    const { page } = await activityEngine({
      ...latestDiagram(),
      ...turningIncidentsAt({ assess: rows }),
    })
    const byTime = (r: (typeof rows)[number]) => r.incidentTimestamp
    const expected = [...rows]
      .sort((a, b) => byTime(b).localeCompare(byTime(a)) || a.id.localeCompare(b.id))
      .map((r) => r.id)

    for (const maxResults of [1, 2, 3, 4]) {
      const { ids, totals } = await walk(page, { activityId: "assess", maxResults })

      expect(ids.flat(), `pages of ${maxResults}`).toEqual(expected)
      expect(totals[0], `pages of ${maxResults}`).toBe(rows.length)
    }
  })

  it("lists a call activity's root incidents alone and totals them on the first page as its group does", async () => {
    // Newest first, a copy between the roots; 23 roots and 4 copies, all of v1.
    const listed = Array.from({ length: 27 }, (_, n) =>
      n % 7 === 3 ? copyAt(n, "callCheck", V1) : row(n, "callCheck", V1),
    )
    const { page, engine } = await activityEngine({
      ...latestDiagram(),
      ...incidentsAt({ callCheck: listed }),
    })

    const { ids, totals } = await walk(page, { activityId: "callCheck" })

    const roots = listed.filter((r) => !("rootCauseIncidentId" in r))
    expect(ids.flat()).toEqual(roots.map((r) => r.id))
    expect(ids.map((page) => page.length)).toEqual([10, 10, 3])
    expect(totals).toEqual([23, null, null])
    // At the element, each page asks its window and a further one where copies drop: at most 24
    // rows. The key's scan, the group's read, holds the key's incidents, so the first page's total
    // reads it once and no statistics, and nothing counts at the call activity, whose count holds
    // the copies, or reads it whole.
    const asked = queriesOf(engine.requests, "/incident")
    const atElement = asked.filter((q) => q.activityId !== undefined)
    expect(Math.max(...atElement.map((q) => Number(q.maxResults)))).toBe(24)
    expect(atElement.every((q) => q.processDefinitionKeyIn === KEY)).toBe(true)
    expect(asked.filter((q) => q.activityId === undefined)).toEqual([
      expect.objectContaining({
        processDefinitionKeyIn: KEY,
        maxResults: `${INCIDENT_SCAN_LIMIT}`,
      }),
    ])
    expect(queriesOf(engine.requests, "/process-definition/statistics")).toEqual([])
    expect(queriesOf(engine.requests, "/incident/count")).toEqual([])
  })

  it("reads the engine-wide statistics on the first page alone where the key's scan cannot hold the key", async () => {
    // The call activity's 23 roots and 4 copies beside 200 root incidents at `assess`, all of v1.
    const world = {
      callCheck: Array.from({ length: 27 }, (_, n) =>
        n % 7 === 3 ? copyAt(n, "callCheck", V1) : row(n, "callCheck", V1),
      ),
      assess: Array.from({ length: INCIDENT_SCAN_LIMIT }, (_, n) => row(n, "assess", V1)),
    }
    const { page, engine } = await activityEngine({
      ...latestDiagram(),
      [`GET /process-definition/${V1}/xml`]: latestDiagram(KEY, V1)[
        `GET /process-definition/${V1}/xml`
      ],
      ...liveCounts(V1, world),
      ...incidentsAt(world),
    })

    const { ids, totals } = await walk(page, { activityId: "callCheck" })

    expect(ids.map((page) => page.length)).toEqual([10, 10, 3])
    // The element counts of v1, which read its call activity whole to tell its roots: 23.
    expect(totals).toEqual([23, null, null])
    expect(queriesOf(engine.requests, "/process-definition/statistics")).toHaveLength(1)
    const scans = queriesOf(engine.requests, "/incident").filter((q) => q.activityId === undefined)
    expect(scans).toHaveLength(1)
  })

  it("totals a first page read whole by its rows, also after a write within the element counts' floor", async () => {
    // Three root incidents at the call activity; a retry resolves the newest between two reads.
    const listed = [0, 1, 2].map((n) => row(n, "callCheck", V2))
    const world = { callCheck: listed }
    const { client, engine, page } = await activityEngine({
      ...latestDiagram(),
      ...liveCounts(V2, world),
      ...incidentsAt(world),
      ...ROUTE_COUNTS,
    })

    const before = await page({ activityId: "callCheck" })
    listed.shift()
    const after = await page({ activityId: "callCheck" })

    expect(before.totalCount).toBe(3)
    expect(after.incidents).toHaveLength(2)
    expect(after).toMatchObject({ totalCount: 2, next: null })
    expect(await groupCountOf(client, engine.baseUrl, "callCheck")).toBe(2)
  })

  it("counts a first page with more as its group does, never below its rows and one more", async () => {
    // The process flow read v2's element counts while the call activity held none (their floor
    // keeps them 30 s); then 12 root incidents are raised there.
    const listed: ReturnType<typeof row>[] = []
    const world: Record<string, ReturnType<typeof row>[]> = { callCheck: listed }
    const { client, engine, page } = await activityEngine({
      ...latestDiagram(),
      ...liveCounts(V2, world),
      ...incidentsAt(world),
      ...ROUTE_COUNTS,
    })
    await readElementCounts(client, [V2])
    listed.push(...Array.from({ length: 12 }, (_, n) => row(n, "callCheck", V2)))

    const first = await page({ activityId: "callCheck" })

    expect(first.incidents).toHaveLength(10)
    expect(first.next).not.toBeNull()
    expect(first.totalCount).toBe(12)
    expect(await groupCountOf(client, engine.baseUrl, "callCheck")).toBe(12)

    // Past the scan, the group counts by the element counts on their floor, which still say none:
    // the page counts the rows it read and one more, so Load more stays.
    world.assess = Array.from({ length: INCIDENT_SCAN_LIMIT }, (_, n) => row(n, "assess", V2))
    const capped = await page({ activityId: "callCheck" })

    expect(capped.incidents).toHaveLength(10)
    expect(capped.totalCount).toBe(11)
  })

  it("counts root incidents alone at an element an older version drew as a call activity", async () => {
    // `assess` is a service task in v2 and was a call activity in v1, whose callers still hold
    // three copies there beside v2's two root incidents.
    const atAssess = [
      row(0, "assess", V2),
      copyAt(1, "assess", V1),
      row(2, "assess", V2),
      copyAt(3, "assess", V1),
      copyAt(4, "assess", V1),
    ]
    const capped = Array.from({ length: INCIDENT_SCAN_LIMIT }, (_, n) => row(n, "sendPolicy", V2))
    const worlds: Record<string, readonly (typeof atAssess)[number][]>[] = [
      { assess: atAssess },
      { assess: atAssess, sendPolicy: capped },
    ]
    for (const world of worlds) {
      const { page } = await activityEngine({
        ...latestDiagram(),
        [`GET /process-definition/${V1}/xml`]: {
          body: {
            id: V1,
            bpmn20Xml: `<definitions><process id="${KEY}"><callActivity id="assess"/></process></definitions>`,
          },
        },
        ...liveCounts(V2, world),
        ...incidentsAt(world),
      })

      const whole = await page({ activityId: "assess" })
      const { ids, totals } = await walk(page, { activityId: "assess", maxResults: 1 })

      expect(whole.incidents.map((i) => i.id)).toEqual([atAssess[0].id, atAssess[2].id])
      expect(whole.totalCount).toBe(2)
      expect(ids).toEqual([[atAssess[0].id], [atAssess[2].id]])
      expect(totals).toEqual([2, null])
    }
  })

  it("fails on a key no version is deployed for, never a page of zeros", async () => {
    await expect(
      pageOn({ "GET /process-definition": { body: [] } }, { activityId: "assess" }),
    ).rejects.toThrow(`No process definition with key "${KEY}" is deployed on this engine.`)
  })

  it("fails on a cursor of another paging, reading no incident", async () => {
    const { page, engine } = await activityEngine({ ...latestDiagram(), ...incidentsAt({}) })

    await expect(page({ activityId: "assess", after: "page-2" })).rejects.toThrow(
      '"page-2" is not a page cursor of this engine',
    )
    expect(queriesOf(engine.requests, "/incident")).toEqual([])
  })

  it("names each row by its instance's business key, and degrades to none", async () => {
    const named = await pageOn(
      {
        ...latestDiagram(),
        ...incidentsAt({ assess: [row(0, "assess", V1), row(1, "assess", V1)] }),
        "GET /process-instance": { body: [{ id: "pi-assess-0", businessKey: "LEA-7" }] },
      },
      { activityId: "assess" },
    )
    const unnamed = await pageOn(
      {
        ...latestDiagram(),
        ...incidentsAt({ assess: [row(0, "assess", V1)] }),
        "GET /process-instance": { status: 500, body: { message: "boom" } },
      },
      { activityId: "assess" },
    )

    expect(named.data.incidents.map((i) => i.businessKey)).toEqual(["LEA-7", null])
    expect(named.requests.find((r) => r.path === "/process-instance")?.query).toEqual({
      processInstanceIds: "pi-assess-0,pi-assess-1",
      maxResults: "2",
    })
    expect(unnamed.data.incidents.map((i) => i.businessKey)).toEqual([null])
  })

  it("links a row on a bare generated definition id by the view's key, never its UUID", async () => {
    // A key over ~25 characters with UUID ids: the engine stores a bare id
    // that names no key (and no version), but the rows still run on the queried key.
    const longKey = "customerOnboardingApprovalProcess"
    const uuid = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
    const { data, requests } = await pageOn(
      { ...latestDiagram(longKey, uuid), ...incidentsAt({ assess: [row(0, "assess", uuid)] }) },
      { activityId: "assess", processDefinitionKey: longKey },
    )

    const url = data.incidents[0].cockpitInstanceUrl
    // The CIB seven route by key; an unknown version is left out (latest).
    expect(url).toContain(`/process/${longKey}/pi-assess-0?tab=incidents`)
    expect(url).not.toContain(uuid)
    // The key's latest diagram, read once by the key, never a definition lookup per row.
    expect(requests.filter((r) => r.path.startsWith("/process-definition"))).toHaveLength(2)
  })
})
