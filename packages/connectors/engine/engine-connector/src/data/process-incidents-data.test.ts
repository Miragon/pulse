import { describe, expect, it } from "vitest"
import { cibsevenProvider } from "../providers/index.js"
import {
  clientFor,
  startFakeEngine,
  type FakeRoutes,
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
  V1,
  V2,
} from "./process-incidents-data.test-support.js"

closeEnginesAfterEach()

const queriesOf = (requests: RecordedRequest[], path: string) =>
  requests.filter((r) => r.path === path).map((r) => r.query)

describe("buildProcessIncidentsData: key-wide (#335 N60)", () => {
  it("counts every version through key-scoped /count endpoints and the root statistics in two parallel stages (N67)", async () => {
    // A complete scan: three incidents, on v1 AND v2.
    const scan = [row(0, "assess", V2), row(1, "assess", V1), row(2, "oldTask", V1)]
    const { data, requests } = await build(definitionRoutes(scan, 3))

    expect(data).toMatchObject({
      processDefinitionKey: KEY,
      processDefinitionName: "Leasing",
      diagramVersion: 2,
      runningInstances: 99,
      failedJobs: 6,
      incidentCount: 3,
      // "1 of the diagram's 2": oldTask (v1 only) has incidents but is no
      // activity of the v2 diagram: it stays in `activities`, outside the
      // fraction, which would otherwise read "2 of 2".
      totalActivityCount: 2,
      affectedDiagramActivityCount: 1,
      latestIncident: scan[0].incidentTimestamp,
      // Only the empty state reads other processes. Unread is null, never [].
      siblingsWithIncidents: null,
    })
    // Per activity, across versions; an activity only v1 has keeps its id.
    expect(data.activities).toEqual([
      {
        activityId: "assess",
        activityName: "Assess creditworthiness",
        representativeMessage: "assess failed",
        incidentCount: 2,
        firstSeen: scan[1].incidentTimestamp,
        latestIncident: scan[0].incidentTimestamp,
      },
      {
        activityId: "oldTask",
        activityName: null,
        representativeMessage: "oldTask failed",
        incidentCount: 1,
        firstSeen: scan[2].incidentTimestamp,
        latestIncident: scan[2].incidentTimestamp,
      },
    ])
    expect(queriesOf(requests, "/process-instance/count")).toEqual([{ processDefinitionKey: KEY }])
    expect(queriesOf(requests, "/job/count")).toEqual([
      { processDefinitionKey: KEY, noRetriesLeft: "true" },
    ])
    // The root incidents from the statistics, never /count, which counts a call activity's copies.
    expect(queriesOf(requests, "/process-definition/statistics")).toEqual([
      { rootIncidents: "true" },
    ])
    // A complete scan needs no per-version reads; the diagram is read by version id, never the
    // tenant-less /key/{key}.
    expect(requests.map((r) => r.path).sort()).toEqual(
      [
        "/incident",
        "/job/count",
        "/process-definition",
        "/process-definition/statistics",
        `/process-definition/${V2}/xml`,
        "/process-instance/count",
      ].sort(),
    )
    expect(queriesOf(requests, "/process-definition")).toEqual([
      { key: KEY, latestVersion: "true", sortBy: "version", sortOrder: "desc", maxResults: "1" },
    ])
  })

  it("resolves a key deployed for a tenant: /process-definition/key/{key} only knows tenant-less ones", async () => {
    // definitionRoutes answers the tenant-less endpoints with the engine's 404.
    const { data } = await build(definitionRoutes([row(0, "assess", V2)], 1))

    expect(data).toMatchObject({ processDefinitionName: "Leasing", diagramVersion: 2 })
    expect(data.diagramDefinitionId).toBe(V2)
  })

  it("fails on a key no version is deployed for, never a view of zeros", async () => {
    await expect(
      build({ ...definitionRoutes([], 0), "GET /process-definition": { body: [] } }),
    ).rejects.toThrow(`No process definition with key "${KEY}" is deployed on this engine.`)
  })

  it("reads each version with root incidents by the process screen's rule when the scan is capped", async () => {
    // 263 open root incidents and 5 copies at a call activity; the 200-row scan holds only the
    // newest, none of oldTask's.
    const rows = (activityId: string, id: string, count: number, from: number) =>
      Array.from({ length: count }, (_, n) => row(from + n, activityId, id))
    const copies = rows("callCheck", V2, 5, 900).map((copy, n) => ({
      ...copy,
      incidentMessage: null,
      rootCauseIncidentId: `called-${n}`,
    }))
    const byVersion: Record<string, unknown[]> = {
      [V1]: [...rows("assess", V1, 100, 0), ...rows("oldTask", V1, 13, 500)],
      [V2]: [...rows("assess", V2, 120, 100), ...rows("sendPolicy", V2, 30, 300), ...copies],
    }
    const scan = [...rows("assess", V2, 180, 0), ...rows("sendPolicy", V2, 20, 300)]
    const stats = (key: string, id: string, incidentCount: number) => ({
      id,
      instances: 1,
      incidents: [{ incidentType: "failedJob", incidentCount }],
      definition: { id, key, version: Number(id.split(":")[1]) },
    })
    const { data, requests } = await build({
      ...definitionRoutes(scan, 263),
      "GET /incident": (r: RecordedRequest) => ({
        body: r.query.processDefinitionId ? atActivity(byVersion, r.query) : scan,
      }),
      [`GET /process-definition/${V1}/xml`]: diagram(
        V1,
        '<serviceTask id="assess"/><serviceTask id="oldTask"/>',
      ),
      [`GET /process-definition/${V2}/xml`]: diagram(
        V2,
        '<serviceTask id="assess" name="Assess creditworthiness"/><serviceTask id="sendPolicy" name="Send policy"/>',
        '<callActivity id="callCheck"/>',
      ),
      "GET /process-definition/statistics": {
        body: [stats(KEY, V1, 113), stats(KEY, V2, 150), stats("other", "other:1:x", 9)],
      },
      [`GET /process-definition/${V1}/statistics`]: {
        body: [at("assess", 100), at("oldTask", 13)],
      },
      [`GET /process-definition/${V2}/statistics`]: {
        body: [at("assess", 120), at("sendPolicy", 30), at("callCheck", 5), at("idle", 0)],
      },
    })

    // Exact root incidents per activity summing to the key's 263; the call activity's copies are
    // no group. The old view showed v2 only (150) next to a key-wide total.
    expect(data.incidentCount).toBe(263)
    expect(data.activities.map((a) => [a.activityId, a.incidentCount])).toEqual([
      ["assess", 220],
      ["sendPolicy", 30],
      ["oldTask", 13],
    ])
    // The scan holds only part of each activity: firstSeen is unknown (null),
    // never the oldest SCANNED timestamp passed off as the first.
    expect(data.activities.map((a) => a.firstSeen)).toEqual([null, null, null])
    expect(data.activities[2]).toMatchObject({ representativeMessage: null, latestIncident: null })
    // Each version once, its jobs without retries and every incident at an element from the same
    // read ("Running" shares it), and the incidents read where copies may lie: v2's call activity.
    expect(queriesOf(requests, `/process-definition/${V1}/statistics`)).toEqual([
      { failedJobs: "true", incidents: "true" },
    ])
    expect(queriesOf(requests, `/process-definition/${V2}/statistics`)).toHaveLength(1)
    expect(
      queriesOf(requests, "/incident")
        .filter((q) => q.processDefinitionId !== undefined)
        .map((q) => [q.processDefinitionId, q.activityId]),
    ).toEqual([[V2, "callCheck"]])
    expect(queriesOf(requests, "/process-definition/statistics")).toEqual([
      { rootIncidents: "true" },
    ])
  })

  it("offers the keys that DO have root incidents when this one has none; fails as the statistics fail", async () => {
    const siblings = await build({
      ...definitionRoutes([], 0),
      "GET /process-definition/statistics": {
        body: [
          { ...at("b:1:x", 0, 2), definition: { id: "b:1:x", key: "b", name: "B", version: 1 } },
          { ...at("b:2:x", 0, 3), definition: { id: "b:2:x", key: "b", name: "B", version: 2 } },
          { ...at(V2, 0, 0), definition: { id: V2, key: KEY, version: 2 } },
        ],
      },
    })
    expect(siblings.data.siblingsWithIncidents).toEqual([
      { processDefinitionKey: "b", processDefinitionName: "B", incidentCount: 5 },
    ])

    // The statistics hold the key's root incidents, the view's count: primary, never 0.
    await expect(
      build({
        ...definitionRoutes([], 0),
        "GET /process-definition/statistics": { status: 500, body: { message: "boom" } },
      }),
    ).rejects.toThrow()
  })
})

/** The key's latest version and its diagram, which draws `assess` as a service task. */
function latestDiagram(key = KEY, definitionId = V2): FakeRoutes {
  return {
    "GET /process-definition": { body: [{ id: definitionId, key, name: "Leasing", version: 2 }] },
    [`GET /process-definition/${definitionId}/xml`]: {
      body: {
        id: definitionId,
        bpmn20Xml: `<definitions><process id="${key}"><serviceTask id="assess" name="Assess creditworthiness"/><callActivity id="callCheck" name="Check applicant"/></process></definitions>`,
      },
    },
  }
}

describe("buildActivityIncidentsData: one page of an activity's incidents (N67)", () => {
  it("pages engine-side with the exact total and links each row to its own version", async () => {
    const engine = await startFakeEngine({
      ...latestDiagram(),
      // The page the engine answers at the activity, wherever it starts; none at its body.
      "GET /incident": (r: RecordedRequest) => ({
        body: r.query.activityId === "assess" ? [row(0, "assess", V1)] : [],
      }),
      "GET /incident/count": (r: RecordedRequest) => ({
        body: { count: r.query.activityId === "assess" ? 57 : 0 },
      }),
    })
    engines.push(engine)

    const data = await buildActivityIncidentsData(clientFor(engine), {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
      processDefinitionKey: KEY,
      activityId: "assess",
      firstResult: 10,
    })

    expect(data.totalCount).toBe(57)
    // The cockpit route of the row's OWN version (v1), not the latest.
    expect(data.incidents[0].cockpitInstanceUrl).toContain(`/process/${KEY}/1/pi-assess-0`)
    expect(engine.requests.map((r) => [r.path, r.query])).toEqual(
      expect.arrayContaining([
        [
          "/incident",
          {
            processDefinitionKeyIn: KEY,
            activityId: "assess",
            sortBy: "incidentTimestamp",
            sortOrder: "desc",
            firstResult: "10",
            maxResults: "10",
          },
        ],
        ["/incident/count", { processDefinitionKeyIn: KEY, activityId: "assess" }],
      ]),
    )
    // No statistics per expanded group: the key's latest diagram (which names the element and
    // tells no call activity), the page, its count, its multi-instance body's count (none) and the
    // page's business keys, ONE read (#322 U13).
    expect(engine.requests.map((r) => r.path).sort()).toEqual([
      "/incident",
      "/incident/count",
      "/incident/count",
      "/process-definition",
      `/process-definition/${V2}/xml`,
      "/process-instance",
    ])
    expect(data.incidents[0].activityName).toBe("Assess creditworthiness")
  })

  it("lists a call activity's root incidents alone, read whole and paged in memory, the copies no row and no part of the total", async () => {
    // Newest first: the engine sorts, a copy between the roots; 23 roots and 4 copies.
    const listed = Array.from({ length: 27 }, (_, n) =>
      n % 7 === 3
        ? { ...row(n, "callCheck", V2), incidentMessage: null, rootCauseIncidentId: `called-${n}` }
        : row(n, "callCheck", V2),
    )
    const engine = await startFakeEngine({
      ...latestDiagram(),
      ...incidentsAt({ callCheck: listed }),
    })
    engines.push(engine)

    const data = await buildActivityIncidentsData(clientFor(engine), {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
      processDefinitionKey: KEY,
      activityId: "callCheck",
      firstResult: 20,
    })

    const roots = listed.filter((r) => !("rootCauseIncidentId" in r))
    expect(data.totalCount).toBe(23)
    expect(data.incidents.map((i) => i.id)).toEqual(roots.slice(20).map((r) => r.id))
    expect(data.incidents.every((i) => i.rootIncidentId === null)).toBe(true)
    // Whole, in pages of 500 from the first, never the engine's count at the call activity (which
    // counts the copies); only its multi-instance body's, which holds none.
    expect(queriesOf(engine.requests, "/incident")).toEqual([
      {
        processDefinitionKeyIn: KEY,
        activityId: "callCheck",
        sortBy: "incidentTimestamp",
        sortOrder: "desc",
        firstResult: "0",
        maxResults: "500",
      },
    ])
    expect(queriesOf(engine.requests, "/incident/count")).toEqual([
      { processDefinitionKeyIn: KEY, activityId: "callCheck#multiInstanceBody" },
    ])
  })

  it("reads an activity whole where the latest diagram cannot tell a call activity", async () => {
    const page = async (routes: FakeRoutes, activityId: string) => {
      const engine = await startFakeEngine({
        ...latestDiagram(),
        ...incidentsAt({
          [activityId]: [
            row(0, activityId, V1),
            { ...row(1, activityId, V1), incidentMessage: null, rootCauseIncidentId: "called-1" },
          ],
        }),
        ...routes,
      })
      engines.push(engine)
      const data = await buildActivityIncidentsData(clientFor(engine), {
        baseUrl: engine.baseUrl,
        provider: cibsevenProvider,
        processDefinitionKey: KEY,
        activityId,
      })
      // Counted at the activity itself never; only at its multi-instance body, which holds none.
      const counted = queriesOf(engine.requests, "/incident/count").filter(
        (query) => query.activityId === activityId,
      )
      return { data, counted: counted.length }
    }

    // An element only an older version has, and a diagram that cannot be read.
    const older = await page({}, "oldCall")
    const unread = await page(
      { [`GET /process-definition/${V2}/xml`]: { status: 500, body: { message: "boom" } } },
      "assess",
    )
    for (const { data, counted } of [older, unread]) {
      expect(data.totalCount).toBe(1)
      expect(data.incidents).toHaveLength(1)
      expect(counted).toBe(0)
    }
    expect(unread.data.incidents[0].activityName).toBeNull()
  })

  it("fails on a key no version is deployed for, never a page of zeros", async () => {
    const engine = await startFakeEngine({ "GET /process-definition": { body: [] } })
    engines.push(engine)
    await expect(
      buildActivityIncidentsData(clientFor(engine), {
        baseUrl: engine.baseUrl,
        provider: cibsevenProvider,
        processDefinitionKey: KEY,
        activityId: "assess",
      }),
    ).rejects.toThrow(`No process definition with key "${KEY}" is deployed on this engine.`)
  })

  it("names each row by its instance's business key, and degrades to none", async () => {
    const engine = await startFakeEngine({
      ...latestDiagram(),
      ...incidentsAt({ assess: [row(0, "assess", V1), row(1, "assess", V1)] }),
      "GET /process-instance": { body: [{ id: "pi-assess-0", businessKey: "LEA-7" }] },
    })
    engines.push(engine)
    const broken = await startFakeEngine({
      ...latestDiagram(),
      ...incidentsAt({ assess: [row(0, "assess", V1)] }),
      "GET /process-instance": { status: 500, body: { message: "boom" } },
    })
    engines.push(broken)
    const build = (target: typeof engine) =>
      buildActivityIncidentsData(clientFor(target), {
        baseUrl: target.baseUrl,
        provider: cibsevenProvider,
        processDefinitionKey: KEY,
        activityId: "assess",
      })

    const named = await build(engine)
    const unnamed = await build(broken)

    expect(named.incidents.map((i) => i.businessKey)).toEqual(["LEA-7", null])
    expect(engine.requests.find((r) => r.path === "/process-instance")?.query).toEqual({
      processInstanceIds: "pi-assess-0,pi-assess-1",
      maxResults: "2",
    })
    expect(unnamed.incidents.map((i) => i.businessKey)).toEqual([null])
  })

  it("links a row on a bare generated definition id by the view's key, never its UUID", async () => {
    // A key over ~25 characters with UUID ids: the engine stores a bare id
    // that names no key (and no version), but the rows still run on the queried key.
    const longKey = "customerOnboardingApprovalProcess"
    const uuid = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
    const engine = await startFakeEngine({
      ...latestDiagram(longKey, uuid),
      ...incidentsAt({ assess: [row(0, "assess", uuid)] }),
    })
    engines.push(engine)

    const data = await buildActivityIncidentsData(clientFor(engine), {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
      processDefinitionKey: longKey,
      activityId: "assess",
    })

    const url = data.incidents[0].cockpitInstanceUrl
    // The CIB seven route by key; an unknown version is left out (latest).
    expect(url).toContain(`/process/${longKey}/pi-assess-0?tab=incidents`)
    expect(url).not.toContain(uuid)
    // The key's latest diagram, read once by the key, never a definition lookup per row.
    expect(engine.requests.filter((r) => r.path.startsWith("/process-definition"))).toHaveLength(2)
  })
})

// One rule (`readBpmnNames`): an unnamed definition takes its pool
// name, in the title and in the empty state alike.
describe("buildProcessIncidentsData: names from a Modeler pool", () => {
  const pooled = (key: string) =>
    `<definitions><collaboration id="C"><participant id="Pool" name="Pool of ${key}" processRef="${key}"/></collaboration><process id="${key}"/></definitions>`

  it("titles the view and names its siblings by their diagrams", async () => {
    const { data } = await build({
      ...definitionRoutes([], 0),
      "GET /process-definition": { body: [{ id: V2, key: KEY, name: null, version: 2 }] },
      [`GET /process-definition/${V2}/xml`]: { body: { id: V2, bpmn20Xml: pooled(KEY) } },
      "GET /process-definition/statistics": {
        body: [{ ...at("b:1:x", 0, 2), definition: { id: "b:1:x", key: "b", version: 1 } }],
      },
      "GET /process-definition/b:1:x/xml": { body: { bpmn20Xml: pooled("b") } },
    })

    expect(data.processDefinitionName).toBe(`Pool of ${KEY}`)
    expect(data.siblingsWithIncidents).toEqual([
      { processDefinitionKey: "b", processDefinitionName: "Pool of b", incidentCount: 2 },
    ])
  })
})
