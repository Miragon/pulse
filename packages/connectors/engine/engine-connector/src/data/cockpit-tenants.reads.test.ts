import { describe, expect, it } from "vitest"
import { cibsevenProvider } from "../providers/index.js"
import { buildActivityIncidentsData } from "./activity-incidents-data.js"
import { buildJobPanelData, buildProcessInstancesData } from "./cockpit-data.js"
import {
  closeTenantWorldsAfterEach,
  ELEMENT,
  KEY,
  NONE,
  NORTH,
  SOUTH_2,
  tenantWorld,
  type Version,
} from "./cockpit-tenants.test-support.js"
import { buildProcessIncidentsData } from "./process-incidents-data.js"

// F17b: where a key is its process's alone, the cockpit reads the key as it always did, so its
// lists hold what its tiles count; where it holds other processes, each read narrows at the
// engine, so another tenant's load never changes the process's facts.

closeTenantWorldsAfterEach()

/** The process view of `tenantId` (the key's process without one) in the world of `versions`. */
async function processView(versions: readonly Version[], tenantId?: string) {
  const world = await tenantWorld(versions)
  const options = {
    baseUrl: world.engine.baseUrl,
    provider: cibsevenProvider,
    processDefinitionKey: KEY,
    ...(tenantId === undefined ? {} : { tenantId }),
  }
  return { ...world, options, data: await buildProcessIncidentsData(world.client, options) }
}

describe("a key's only process reads its key, as before", () => {
  // Deployed without a tenant alone, its runs carry the tenant a tenant id provider gave them.
  const shared: Version = {
    id: "label:1:shared",
    tenantId: null,
    version: 1,
    running: 5,
    failedJobs: 2,
    incidents: 0,
    runTenant: "acme",
  }

  it("counts its runs by its key, whatever tenant they carry, with the requests it always sent", async () => {
    const { data, queriesOf } = await processView([shared])

    expect(data).toMatchObject({ runningInstances: 5, failedJobs: 2, incidentCount: 0 })
    expect(data.sharesKey).toBeUndefined()
    expect(data.tenantId).toBeUndefined()
    expect(queriesOf("/process-definition")).toEqual([
      { key: KEY, latestVersion: "true", sortBy: "version", sortOrder: "desc" },
    ])
    expect(queriesOf("/process-instance/count")).toEqual([{ processDefinitionKey: KEY }])
    expect(queriesOf("/job/count")).toEqual([{ processDefinitionKey: KEY, noRetriesLeft: "true" }])
    expect(queriesOf("/incident")).toEqual([
      {
        processDefinitionKeyIn: KEY,
        maxResults: "200",
        sortBy: "incidentTimestamp",
        sortOrder: "desc",
      },
    ])
  })

  it("lists by its key alone what its tiles count, as its drills open them", async () => {
    const { client, queriesOf, bodiesOf } = await tenantWorld([shared])

    const instances = await buildProcessInstancesData(client, "fake", { processDefinitionKey: KEY })
    const jobs = await buildJobPanelData(client, "fake", {
      processDefinitionKey: KEY,
      failedOnly: true,
    })

    expect(instances.totalCount).toBe(5)
    expect(jobs.failedCount).toBe(2)
    // No tenant filter anywhere; a row's process is its version's, read by its id.
    const filters = [...bodiesOf("/process-instance/count"), ...queriesOf("/job/count")]
    expect(filters.some((filter) => JSON.stringify(filter).includes("enant"))).toBe(false)
    expect(new Set(instances.instances.map((row) => row.tenantId))).toEqual(new Set([undefined]))
    // Narrowed to the runs in none, the list would hold none of what the tiles count.
    const none = await buildProcessInstancesData(client, "fake", {
      processDefinitionKey: KEY,
      onlyTenant: null,
    })
    expect(none.totalCount).toBe(0)
  })
})

describe("a key on an engine without tenants", () => {
  const plain: Version = { ...NONE, running: 3, failedJobs: 1 }

  it("sends the list requests it always sent", async () => {
    const { client, queriesOf, bodiesOf } = await tenantWorld([plain])

    await buildProcessInstancesData(client, "fake", { processDefinitionKey: KEY })
    await buildJobPanelData(client, "fake", { processDefinitionKey: KEY })

    const latest = { key: KEY, latestVersion: "true", sortBy: "version", sortOrder: "desc" }
    expect(queriesOf("/process-definition")).toEqual([
      { ...latest, maxResults: "1" },
      { ...latest, maxResults: "1" },
    ])
    expect(queriesOf("/process-definition/statistics")).toEqual([])
    const filters = [...bodiesOf("/process-instance/count"), ...queriesOf("/job/count")]
    expect(filters.some((filter) => JSON.stringify(filter).includes("enant"))).toBe(false)
  })
})

describe("a process whose key holds others narrows its incidents at the engine", () => {
  // North raised one incident long ago; south, the same key in another tenant, 205 since.
  const quietNorth: Version = { ...NORTH, incidentsAgo: 1000 }
  const busySouth: Version = { ...SOUTH_2, incidents: 205 }
  const northRaised = new Date(Date.UTC(2026, 10, 27, 8, 0) - 1000 * 60_000).toISOString()

  it("names its latest incident and its group's facts, however many another tenant raised since", async () => {
    const { data, queriesOf } = await processView([quietNorth, busySouth], "north")

    expect(data).toMatchObject({ incidentCount: 1, latestIncident: northRaised })
    expect(data.activities).toEqual([
      expect.objectContaining({
        activityId: ELEMENT,
        incidentCount: 1,
        representativeMessage: "north failed",
        firstSeen: northRaised,
        latestIncident: northRaised,
      }),
    ])
    // Read by north's version alone: never the key, never south's.
    expect(queriesOf("/incident")).toEqual([
      expect.objectContaining({ processDefinitionId: NORTH.id, maxResults: "200" }),
    ])
  })

  it("pages an activity's incidents of its versions alone, and counts them", async () => {
    const { client, engine, queriesOf } = await tenantWorld([quietNorth, busySouth])

    const page = await buildActivityIncidentsData(client, {
      baseUrl: engine.baseUrl,
      provider: cibsevenProvider,
      processDefinitionKey: KEY,
      tenantId: "north",
      activityId: ELEMENT,
    })

    expect(page.incidents.map((incident) => incident.id)).toEqual(["inc-north-0"])
    expect(page.totalCount).toBe(1)
    expect(page.next).toBeNull()
    const read = new Set(queriesOf("/incident").map((query) => query.processDefinitionId))
    expect(read).toEqual(new Set([NORTH.id]))
  })

  it("keeps the busy tenant's own facts too", async () => {
    const { data } = await processView([quietNorth, busySouth], "south")

    expect(data.incidentCount).toBe(205)
    expect(data.latestIncident).toBe(new Date(Date.UTC(2026, 10, 27, 8, 0)).toISOString())
    expect(data.activities[0]).toMatchObject({ incidentCount: 205, firstSeen: null })
  })
})
