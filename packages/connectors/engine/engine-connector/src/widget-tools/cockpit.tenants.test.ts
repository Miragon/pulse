import { afterEach, describe, expect, it } from "vitest"
import {
  closeTenantWorldsAfterEach,
  KEY,
  tenantWorld,
} from "../data/cockpit-tenants.test-support.js"
import { closeFakeEngines, cockpitOn, dataOf, factsOf, textOf } from "./cockpit.test-support.js"

// F17b: `engine_open_cockpit` opens a process, a key in one tenant: `tenantId` on the process view
// alone (strict input, the parameter name engine_get_screen takes), its facts naming the tenant it
// read, and the key's process without a tenant, else its first tenant by id, where none is named.

afterEach(closeFakeEngines)
closeTenantWorldsAfterEach()

async function onTenantWorld() {
  const world = await tenantWorld()
  return (await cockpitOn([{ id: "solo", baseUrl: world.engine.baseUrl }])).handler
}

describe("engine_open_cockpit: a process in one tenant", () => {
  it("opens the process in the tenant asked for, its facts that tenant's numbers", async () => {
    const open = await onTenantWorld()
    const result = await open({
      view: "process-detail",
      processDefinitionKey: KEY,
      tenantId: "south",
    })
    expect(factsOf(result)).toEqual({
      engine: "solo",
      view: "process-detail",
      processDefinitionKey: KEY,
      tenantId: "south",
      diagramVersion: 2,
      runningInstances: 7,
      rootIncidentCount: 2,
      failedJobs: 0,
      affectedActivities: 1,
    })
    expect((dataOf(result).start as { view: object }).view).toEqual({
      section: "process-detail",
      processDefinitionKey: KEY,
      tenantId: "south",
    })
  })

  it("without a tenant, the process without one: its facts name none", async () => {
    const open = await onTenantWorld()
    const facts = factsOf(await open({ view: "process-detail", processDefinitionKey: KEY }))
    expect(facts).not.toHaveProperty("tenantId")
    expect(facts).toMatchObject({ diagramVersion: 1, runningInstances: 1, rootIncidentCount: 0 })
  })

  it("a tenant that holds no version of the key is a tool error, never a view of zeros", async () => {
    const open = await onTenantWorld()
    const result = await open({
      view: "process-detail",
      processDefinitionKey: KEY,
      tenantId: "east",
    })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain(`is deployed in tenant "east"`)
  })

  it("takes the tenant on the process view alone", async () => {
    const { definition } = await cockpitOn([{ id: "solo" }])
    const issues = (args: Record<string, unknown>) => {
      const parsed = definition.inputSchema.safeParse(args)
      return parsed.success ? [] : parsed.error.issues.map((i) => [i.path.join("."), i.message])
    }
    expect(
      issues({ view: "process-detail", processDefinitionKey: KEY, tenantId: "north" }),
    ).toEqual([])
    expect(
      issues({ view: "process-instances", processDefinitionKey: KEY, tenantId: "north" }),
    ).toEqual([
      ["tenantId", 'view "process-instances" takes no tenantId (it takes processDefinitionKey).'],
    ])
    expect(
      issues({ view: "process-detail", processDefinitionKey: KEY, tenantId: "" }),
    ).toHaveLength(1)
  })
})
