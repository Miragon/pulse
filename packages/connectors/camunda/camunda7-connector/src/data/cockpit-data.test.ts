import { afterEach, describe, expect, it } from "vitest"
import {
  clientFor,
  startFakeEngine,
  type FakeEngine,
  type FakeRoutes,
  type RecordedRequest,
} from "../tools/test-support/fake-engine.js"
import {
  buildCockpitDashboardData,
  buildProcessInstancesData,
  buildProcessListData,
} from "./cockpit-data.js"

// The failure half is the rejection table in `honest-numbers.test.ts`.

const engines: FakeEngine[] = []
afterEach(async () => {
  await Promise.all(engines.splice(0).map((engine) => engine.close()))
})

async function engineWith(routes: FakeRoutes) {
  const engine = await startFakeEngine(routes, { body: [] })
  engines.push(engine)
  return { engine, client: clientFor(engine) }
}

const calls = (engine: FakeEngine, path: string) => engine.requests.filter((r) => r.path === path)

const statsRow = (key: string, version: number, over: Record<string, unknown> = {}) => ({
  id: `${key}:${version}:d`,
  definition: { id: `${key}:${version}:d`, key, name: key.toUpperCase(), version },
  ...over,
})

describe("buildCockpitDashboardData — one row per KEY (#335 N60)", () => {
  it("sums instances, failed jobs and incidents over every version of a key", async () => {
    const { engine, client } = await engineWith({
      "GET /process-definition/statistics": {
        body: [
          statsRow("leasing", 1, {
            instances: 38,
            failedJobs: 1,
            incidents: [{ incidentType: "failedJob", incidentCount: 30 }],
          }),
          statsRow("leasing", 2, {
            instances: 61,
            failedJobs: 5,
            incidents: [
              { incidentType: "failedJob", incidentCount: 27 },
              { incidentType: "custom", incidentCount: 1 },
            ],
          }),
          statsRow("quiet", 1, { instances: 200, failedJobs: 0, incidents: [] }),
        ],
      },
    })

    const data = await buildCockpitDashboardData(client, "engine-a")

    // The latest-version-only figures were 61 / 5 / 28 — the old bug.
    expect(data.definitions[0]).toEqual({
      id: "leasing:2:d",
      key: "leasing",
      name: "LEASING",
      latestVersion: 2,
      instances: 99,
      failedJobs: 6,
      incidents: [
        { incidentType: "failedJob", incidentCount: 57 },
        { incidentType: "custom", incidentCount: 1 },
      ],
    })
    expect(data.summary).toEqual({
      totalDefinitions: 2,
      totalRunningInstances: 299,
      totalFailedJobs: 6,
      totalIncidents: 58,
    })
    // Issues first, then the busier key.
    expect(data.definitions.map((d) => d.key)).toEqual(["leasing", "quiet"])
    expect(data.engineId).toBe("engine-a")
    // ONE engine-wide statistics call with failed jobs and incidents.
    expect(engine.requests).toHaveLength(1)
    expect(engine.requests[0].query).toEqual({ failedJobs: "true", incidents: "true" })
  })

  it("defaults missing counters and names, and skips rows without a key", async () => {
    const { client } = await engineWith({
      "GET /process-definition/statistics": {
        body: [{ id: "K1:1:a", definition: { id: "K1:1:a", key: "K1", version: 1 } }, { id: "x" }],
      },
    })

    const data = await buildCockpitDashboardData(client, "engine-a")

    expect(data.definitions).toEqual([
      {
        id: "K1:1:a",
        key: "K1",
        name: null,
        latestVersion: 1,
        instances: 0,
        failedJobs: 0,
        incidents: [],
      },
    ])
  })
})

describe("buildProcessListData", () => {
  it("forwards the filters and reports the engine-side total", async () => {
    const { engine, client } = await engineWith({
      "GET /process-definition": { body: [{ id: "K1:1:a", key: "K1" }] },
      "GET /process-definition/count": { body: { count: 42 } },
    })

    const data = await buildProcessListData(client, "engine-a", {
      processDefinitionKey: "K1",
      nameLike: "Ord",
      latestVersion: false,
      firstResult: 20,
      maxResults: 10,
    })

    const [list] = calls(engine, "/process-definition")
    // A LIKE value without % would match the name exactly; latestVersion=false
    // is ignored by the engine — "all versions" means: not sent.
    expect(list.query).toEqual({
      key: "K1",
      nameLike: "%Ord%",
      firstResult: "20",
      maxResults: "10",
      sortBy: "name",
      sortOrder: "asc",
    })
    expect(calls(engine, "/process-definition/count")[0].query).toEqual({
      key: "K1",
      nameLike: "%Ord%",
    })
    expect(data.totalCount).toBe(42)
    expect(data.filters).toEqual({
      processDefinitionKey: "K1",
      nameLike: "Ord",
      latestVersion: false,
    })
  })

  it("defaults latestVersion to true and paging to the first page of 50 (negative offset → 0)", async () => {
    const { engine, client } = await engineWith({
      "GET /process-definition/count": { body: { count: 0 } },
    })

    const data = await buildProcessListData(client, "engine-a", { firstResult: -5 })

    expect(calls(engine, "/process-definition")[0].query).toMatchObject({
      latestVersion: "true",
      firstResult: "0",
      maxResults: "50",
    })
    expect(data.filters.latestVersion).toBe(true)
  })
})

const bodyOf = (r: RecordedRequest) => r.body as Record<string, unknown>

function instanceRoutes(counts: { all: number; withIncident: number; suspended: number }) {
  return {
    "GET /process-instance": { body: [{ id: "p2" }] },
    "POST /process-instance": {
      body: [
        { id: "p1", definitionId: "K1:7:dep", businessKey: "BK-1", suspended: false },
        { id: "p2", definitionId: "K1:7:dep", businessKey: null, suspended: true },
        { id: "", definitionId: "K1:1:a" },
        { id: "p3", definitionId: "legacy-id" },
      ],
    },
    "POST /process-instance/count": (r: RecordedRequest) => ({
      body: {
        count: bodyOf(r).withIncident
          ? counts.withIncident
          : bodyOf(r).suspended
            ? counts.suspended
            : counts.all,
      },
    }),
    // The key's latest version over every tenant (a tenant deployment has no
    // tenant-less /process-definition/key/{key}).
    "GET /process-definition": {
      body: [{ id: "K1:7:dep", key: "K1", name: "Order", version: 7, tenantId: "acme" }],
    },
  }
}

describe("buildProcessInstancesData — totals and page-scoped incident flags (#335 N65)", () => {
  it("flags incidents with ONE query over the page's ids and reports filtered-set totals", async () => {
    const { engine, client } = await engineWith(
      instanceRoutes({ all: 152, withIncident: 57, suspended: 9 }),
    )

    const data = await buildProcessInstancesData(client, "engine-a", { processDefinitionKey: "K1" })

    expect(data.instances).toEqual([
      {
        id: "p1",
        businessKey: "BK-1",
        processDefinitionKey: "K1",
        // A scoped list's rows run on its definition: named by its key lookup.
        processDefinitionName: "Order",
        version: 7,
        suspended: false,
        hasIncident: false,
      },
      {
        id: "p2",
        businessKey: null,
        processDefinitionKey: "K1",
        processDefinitionName: "Order",
        version: 7,
        suspended: true,
        hasIncident: true,
      },
      {
        id: "p3",
        businessKey: null,
        // A bare generated id names no key — a scoped list's rows run on its key.
        processDefinitionKey: "K1",
        processDefinitionName: "Order",
        version: null,
        suspended: false,
        hasIncident: false,
      },
    ])
    // Whole-set totals from /count — never the page's 1 incident / 1 suspended.
    expect(data).toMatchObject({
      processDefinitionName: "Order",
      totalCount: 152,
      returnedCount: 3,
      withIncidentCount: 57,
      suspendedCount: 9,
    })
    const flagQuery = calls(engine, "/process-instance").find((r) => r.method === "GET")
    expect(flagQuery?.query).toEqual({
      processInstanceIds: "p1,p2,p3",
      withIncident: "true",
      maxResults: "3",
    })
    // No engine-wide incident scan decorates the page any more.
    expect(calls(engine, "/incident")).toEqual([])
    expect(calls(engine, "/process-instance/count").map(bodyOf)).toEqual([
      { processDefinitionKey: "K1" },
      { processDefinitionKey: "K1", withIncident: true },
      { processDefinitionKey: "K1", suspended: true },
    ])
  })

  it("answers the totals a filter already decides without asking", async () => {
    const { engine, client } = await engineWith(
      instanceRoutes({ all: 4, withIncident: 4, suspended: 0 }),
    )

    const data = await buildProcessInstancesData(client, "engine-a", {
      withIncidents: true,
      active: true,
    })

    expect(data).toMatchObject({ totalCount: 4, withIncidentCount: 4, suspendedCount: 0 })
    expect(calls(engine, "/process-instance/count")).toHaveLength(1)
    // Every row of a withIncident page has one — no flag query either.
    expect(calls(engine, "/process-instance")).toHaveLength(1)
    expect(data.instances.every((i) => i.hasIncident)).toBe(true)
  })

  it("never forwards a false flag, and sends a false active/suspended as the complement", async () => {
    const { engine, client } = await engineWith(
      instanceRoutes({ all: 0, withIncident: 0, suspended: 0 }),
    )

    await buildProcessInstancesData(client, "engine-a", {
      withIncidents: false,
      businessKeyLike: "",
    })
    await buildProcessInstancesData(client, "engine-a", { suspended: false })
    await buildProcessInstancesData(client, "engine-a", { active: false, businessKeyLike: "BK" })

    const pages = calls(engine, "/process-instance").filter((r) => r.method === "POST")
    expect(pages.map((r) => r.query)).toEqual(
      Array.from({ length: 3 }, () => ({ firstResult: "0", maxResults: "50" })),
    )
    const sorting = [
      { sortBy: "businessKey", sortOrder: "asc" },
      { sortBy: "instanceId", sortOrder: "asc" },
    ]
    expect(pages.map(bodyOf)).toEqual([
      { sorting },
      { active: true, sorting },
      { suspended: true, businessKeyLike: "%BK%", sorting },
    ])
  })

  it("pages in one total order: by business key, the instance id breaking the ties", async () => {
    // Most instances carry no business key: without the id as a second key,
    // "Load more" could repeat some of the tied rows and skip others.
    const { engine, client } = await engineWith(
      instanceRoutes({ all: 120, withIncident: 0, suspended: 0 }),
    )

    await buildProcessInstancesData(client, "engine-a", { firstResult: 50, maxResults: 50 })

    const [page] = calls(engine, "/process-instance").filter((r) => r.method === "POST")
    expect(page?.query).toEqual({ firstResult: "50", maxResults: "50" })
    expect(bodyOf(page).sorting).toEqual([
      { sortBy: "businessKey", sortOrder: "asc" },
      { sortBy: "instanceId", sortOrder: "asc" },
    ])
  })

  it("searches a business key fragment OR a whole id, over the page and every count", async () => {
    const { engine, client } = await engineWith(
      instanceRoutes({ all: 1, withIncident: 0, suspended: 0 }),
    )

    // The operator's search replaces the handed-in prefilter, as the box always did.
    const data = await buildProcessInstancesData(client, "engine-a", {
      processDefinitionKey: "K1",
      businessKeyLike: "BK",
      search: " 73059b49-c64b-11f1 ",
    })

    const orQueries = [
      { businessKeyLike: "%73059b49-c64b-11f1%", processInstanceIds: ["73059b49-c64b-11f1"] },
    ]
    const reads = calls(engine, "/process-instance")
      .filter((r) => r.method === "POST")
      .concat(calls(engine, "/process-instance/count"))
    expect(reads).toHaveLength(4)
    for (const read of reads) {
      expect(bodyOf(read)).toMatchObject({ processDefinitionKey: "K1", orQueries })
      expect(bodyOf(read)).not.toHaveProperty("businessKeyLike")
    }
    // The echo names what the count covers: the search, not the replaced prefilter.
    expect(data.filters).toEqual({
      active: undefined,
      suspended: undefined,
      withIncidents: undefined,
      search: "73059b49-c64b-11f1",
    })
  })

  it("keeps a handed-in businessKeyLike when the search is blank", async () => {
    const { engine, client } = await engineWith(
      instanceRoutes({ all: 1, withIncident: 0, suspended: 0 }),
    )

    const data = await buildProcessInstancesData(client, "engine-a", {
      businessKeyLike: "BK",
      search: "   ",
    })

    const [page] = calls(engine, "/process-instance").filter((r) => r.method === "POST")
    expect(bodyOf(page)).toMatchObject({ businessKeyLike: "%BK%" })
    expect(bodyOf(page)).not.toHaveProperty("orQueries")
    expect(data.filters).toMatchObject({ businessKeyLike: "BK" })
    expect(data.filters).not.toHaveProperty("search")
  })

  it("refuses active and suspended together instead of listing one state", async () => {
    const { engine, client } = await engineWith({})
    await expect(
      buildProcessInstancesData(client, "engine-a", { active: true, suspended: true }),
    ).rejects.toThrow(/contradict each other/)
    expect(engine.requests).toEqual([])
  })

  it("skips the definition lookup when unscoped and reports a null key", async () => {
    const { engine, client } = await engineWith(
      instanceRoutes({ all: 0, withIncident: 0, suspended: 0 }),
    )

    const data = await buildProcessInstancesData(client, "engine-a", {})

    // No key lookup — only the page's names, ONE read over its versions (#322 U13).
    expect(calls(engine, "/process-definition").map((r) => r.query)).toEqual([
      { processDefinitionIdIn: "K1:7:dep,legacy-id", maxResults: "2" },
    ])
    expect(data.instances.map((i) => i.processDefinitionName)).toEqual(["Order", "Order", null])
    // Only p3's bare id needs the statistics; they do not list it — null, not "legacy-id".
    expect(calls(engine, "/process-definition/statistics")).toHaveLength(1)
    expect(data.instances.map((i) => i.processDefinitionKey)).toEqual(["K1", "K1", null])
    expect(data.processDefinitionKey).toBeNull()
    expect(data.processDefinitionName).toBeNull()
  })
})

describe("buildProcessInstancesData — each row's real definition key", () => {
  // A long key with UUID ids gets a bare id; parsed, that UUID would drill into
  // a definition view no key matches.
  const LONG_KEY = "customerOnboardingApprovalProcess"
  const UUID = "6f1c2a9e-0b7d-4c33-9a51-3d2e8f40b7aa"
  const STATS = {
    body: [
      {
        id: UUID,
        instances: 1,
        incidents: [],
        definition: { id: UUID, key: LONG_KEY, version: 3 },
      },
    ],
  }
  const routes = (statistics: FakeRoutes[string]) => ({
    "POST /process-instance": (r: RecordedRequest) => {
      const onLongKey = { id: "p1", definitionId: UUID, businessKey: "BK-1", suspended: false }
      const onOrder = {
        id: "p2",
        definitionId: "order:2:d2",
        businessKey: "BK-2",
        suspended: false,
      }
      return { body: bodyOf(r).processDefinitionKey ? [onLongKey] : [onLongKey, onOrder] }
    },
    "POST /process-instance/count": { body: { count: 2 } },
    "GET /process-definition": {
      body: [{ id: UUID, key: LONG_KEY, name: "Onboarding", version: 3 }],
    },
    "GET /process-definition/statistics": statistics,
  })
  const keysOf = (data: { instances: Array<{ processDefinitionKey: string | null }> }) =>
    data.instances.map((i) => i.processDefinitionKey)

  it("resolves a bare UUID definition id through ONE statistics read in the engine-wide list", async () => {
    const { engine, client } = await engineWith(routes(STATS))

    const data = await buildProcessInstancesData(client, "engine-a", {})

    expect(keysOf(data)).toEqual([LONG_KEY, "order"])
    expect(calls(engine, "/process-definition/statistics")).toHaveLength(1)
  })

  it("leaves an unresolvable key null when the statistics fail — never the UUID (enrichment)", async () => {
    const { client } = await engineWith(
      routes({ status: 500, body: { type: "ProcessEngineException", message: "boom" } }),
    )

    const data = await buildProcessInstancesData(client, "engine-a", {})

    // The row renders "—" and offers no drill; the id that names its key keeps it.
    expect(keysOf(data)).toEqual([null, "order"])
    expect(data.totalCount).toBe(2)
  })

  it("gives a scoped list's rows its key without reading the statistics", async () => {
    const { engine, client } = await engineWith(routes(STATS))

    const data = await buildProcessInstancesData(client, "engine-a", {
      processDefinitionKey: LONG_KEY,
    })

    expect(keysOf(data)).toEqual([LONG_KEY])
    expect(calls(engine, "/process-definition/statistics")).toEqual([])
  })
})
