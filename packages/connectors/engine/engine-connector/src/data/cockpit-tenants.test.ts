import { describe, expect, it } from "vitest"
import { cibsevenProvider } from "../providers/index.js"
import { buildActivityIncidentsData } from "./activity-incidents-data.js"
import { buildActivityStatisticsData } from "./activity-statistics-data.js"
import {
  buildCockpitDashboardData,
  buildJobPanelData,
  buildProcessInstancesData,
} from "./cockpit-data.js"
import {
  closeTenantWorldsAfterEach,
  ELEMENT,
  KEY,
  NONE,
  NORTH,
  SOUTH_2,
  tenantWorld,
} from "./cockpit-tenants.test-support.js"
import { buildIncidentsDashboardData } from "./incidents-dashboard-data.js"
import { buildProcessIncidentsData } from "./process-incidents-data.js"

// F17b: the chat cockpit reads a process, a key in one tenant (owner decision 2026-11-26), never a
// key folded over its tenants. The world (cockpit-tenants.test-support.ts) deploys `label` without
// a tenant, in north and in south (two versions), each with numbers of its own.

closeTenantWorldsAfterEach()

async function processRoute(tenantId?: string) {
  const world = await tenantWorld()
  const data = await buildProcessIncidentsData(world.client, {
    baseUrl: world.engine.baseUrl,
    provider: cibsevenProvider,
    processDefinitionKey: KEY,
    ...(tenantId === undefined ? {} : { tenantId }),
  })
  return { data, ...world }
}

describe("the process route reads one process: its key in one tenant", () => {
  it("in the tenant asked for: its latest version, its counts, its incidents alone", async () => {
    const { data, queriesOf } = await processRoute("south")

    expect(data).toMatchObject({
      processDefinitionKey: KEY,
      tenantId: "south",
      sharesKey: true,
      diagramVersion: 2,
      diagramDefinitionId: SOUTH_2.id,
      runningInstances: 7,
      failedJobs: 0,
      incidentCount: 2,
      activities: [
        { activityId: ELEMENT, incidentCount: 2, representativeMessage: "south failed" },
      ],
      siblingsWithIncidents: null,
    })
    // The counts narrow to the tenant; the latest per tenant is read once, the process's among
    // them; the incidents are read by the version that holds them, never by the key.
    expect(queriesOf("/process-instance/count")).toEqual([
      { processDefinitionKey: KEY, tenantIdIn: "south" },
    ])
    expect(queriesOf("/job/count")).toEqual([
      { processDefinitionKey: KEY, noRetriesLeft: "true", tenantIdIn: "south" },
    ])
    expect(queriesOf("/process-definition")).toEqual([
      { key: KEY, latestVersion: "true", sortBy: "version", sortOrder: "desc" },
    ])
    expect(queriesOf("/incident").map((query) => query.processDefinitionId)).toEqual([SOUTH_2.id])
  })

  it("without one, the process the key names: none where the key has a version without one", async () => {
    const { data, queriesOf } = await processRoute()

    expect(data.tenantId).toBeUndefined()
    expect(data).toMatchObject({
      diagramDefinitionId: NONE.id,
      runningInstances: 1,
      failedJobs: 0,
      incidentCount: 0,
      activities: [],
    })
    expect(queriesOf("/process-instance/count")).toEqual([
      { processDefinitionKey: KEY, withoutTenantId: "true" },
    ])
    // The key's other tenants are other processes, each with its incidents and its tenant.
    expect(data.siblingsWithIncidents).toEqual([
      {
        processDefinitionKey: KEY,
        tenantId: "south",
        processDefinitionName: "Label",
        incidentCount: 2,
      },
      {
        processDefinitionKey: KEY,
        tenantId: "north",
        processDefinitionName: "Label",
        incidentCount: 1,
      },
    ])
  })

  it("fails on a tenant that holds no version of the key, never a view of zeros", async () => {
    await expect(processRoute("east")).rejects.toThrow(
      `No process definition with key "${KEY}" is deployed in tenant "east" on this engine.`,
    )
  })
})

describe("the process's flow and an activity's incidents are its tenant's", () => {
  it("Running sums the tenant's versions onto its latest diagram", async () => {
    const { client } = await tenantWorld()
    const data = await buildActivityStatisticsData(client, {
      processDefinitionKey: KEY,
      tenantId: "south",
      source: "runtime",
    })
    expect(data).toMatchObject({
      tenantId: "south",
      diagramDefinitionId: SOUTH_2.id,
      versionCount: 2,
      activities: [{ activityId: ELEMENT, running: 5, incidents: 2 }],
    })
  })

  it("Throughput counts the tenant's instances, the process without one by withoutTenantId", async () => {
    const { client, queriesOf } = await tenantWorld()
    const nowMs = Date.UTC(2026, 10, 27, 9, 0)
    for (const tenantId of ["north", undefined]) {
      await buildActivityStatisticsData(
        client,
        { processDefinitionKey: KEY, tenantId, source: "history" },
        nowMs,
      )
    }
    const tenantsCounted = queriesOf("/history/process-instance/count").map(
      (query) => query.tenantIdIn ?? (query.withoutTenantId ? "none" : "every"),
    )
    expect(tenantsCounted).toEqual(["north", "none"])
  })

  it("an activity's page lists its tenant's versions' root incidents alone", async () => {
    const { engine, client } = await tenantWorld()
    const page = (tenantId?: string) =>
      buildActivityIncidentsData(client, {
        baseUrl: engine.baseUrl,
        provider: cibsevenProvider,
        processDefinitionKey: KEY,
        ...(tenantId === undefined ? {} : { tenantId }),
        activityId: ELEMENT,
      })
    const south = await page("south")
    expect(south.tenantId).toBe("south")
    expect(south.incidents.map((incident) => incident.id)).toEqual(["inc-south-0", "inc-south-1"])
    expect(south.totalCount).toBe(2)
    expect((await page("north")).incidents.map((incident) => incident.id)).toEqual(["inc-north-0"])
    expect((await page()).incidents).toEqual([])
  })
})

describe("the overview and the lists keep a key's tenants apart", () => {
  it("the overview lists a row per process, each naming its tenant where it has one", async () => {
    const { client } = await tenantWorld()
    const data = await buildCockpitDashboardData(client, "fake")
    const rows = data.definitions.map(({ key, tenantId, latestVersion, instances }) => ({
      key,
      tenantId,
      latestVersion,
      instances,
    }))
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: KEY, tenantId: undefined, latestVersion: 1, instances: 1 },
        { key: KEY, tenantId: "north", latestVersion: 1, instances: 2 },
        { key: KEY, tenantId: "south", latestVersion: 2, instances: 7 },
      ]),
    )
    expect(data.summary.totalDefinitions).toBe(3)
    expect(Object.hasOwn(data.definitions.find((row) => !row.tenantId) ?? {}, "tenantId")).toBe(
      false,
    )
  })

  it("the incidents dashboard has a card per process, each naming its tenant", async () => {
    const { engine, client } = await tenantWorld()
    const data = await buildIncidentsDashboardData(client, {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
    })
    const cards = data.processes.map(({ processDefinitionKey, tenantId, incidentCount }) => ({
      processDefinitionKey,
      tenantId,
      incidentCount,
    }))
    expect(cards).toEqual([
      { processDefinitionKey: KEY, tenantId: "south", incidentCount: 2 },
      { processDefinitionKey: KEY, tenantId: "north", incidentCount: 1 },
    ])
    expect(data.processes.map((card) => card.scannedIncidentCount)).toEqual([2, 1])
    expect(data.processes[1].latestVersion).toBe(NORTH.version)
    expect(data.totalCount).toBe(3)
  })

  it("a process's instances narrow its key to its tenant, none by withoutTenantId", async () => {
    const { client, bodiesOf } = await tenantWorld()
    const north = await buildProcessInstancesData(client, "fake", {
      processDefinitionKey: KEY,
      onlyTenant: "north",
    })
    const none = await buildProcessInstancesData(client, "fake", {
      processDefinitionKey: KEY,
      onlyTenant: null,
    })
    const every = await buildProcessInstancesData(client, "fake", { processDefinitionKey: KEY })
    expect([north.onlyTenant, none.onlyTenant, every.onlyTenant]).toEqual([
      "north",
      null,
      undefined,
    ])
    expect([north.totalCount, none.totalCount, every.totalCount]).toEqual([2, 1, 10])
    // A row names its version's tenant, the process its drill opens.
    expect(new Set(north.instances.map((row) => row.tenantId))).toEqual(new Set(["north"]))
    const scopes = bodiesOf("/process-instance/count").map((body) => {
      const { tenantIdIn, withoutTenantId } = body as Record<string, unknown>
      return tenantIdIn ?? (withoutTenantId ? "none" : "every")
    })
    expect(new Set(scopes.map((scope) => JSON.stringify(scope)))).toEqual(
      new Set(['["north"]', '"none"', '"every"']),
    )
  })

  it("a process's jobs narrow its key to its tenant, in the list and both counts", async () => {
    const { client, queriesOf, bodiesOf } = await tenantWorld()
    const data = await buildJobPanelData(client, "fake", {
      processDefinitionKey: KEY,
      onlyTenant: "north",
    })
    expect(data.failedCount).toBe(NORTH.failedJobs)
    expect(data.filters).toEqual({
      processDefinitionKey: KEY,
      onlyTenant: "north",
      failedOnly: undefined,
    })
    expect(queriesOf("/job/count").map((query) => query.tenantIdIn)).toEqual(["north", "north"])
    expect(bodiesOf("/job")).toEqual([expect.objectContaining({ tenantIdIn: ["north"] })])
  })
})
