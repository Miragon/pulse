import { BpmnProcessId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { loadInstanceData } from "../inspect.js"
import { instanceView } from "../snapshot.js"
import { fakeFailure, fakePort, type FakeCall, type Route } from "../testing/fake-port.js"
import { InstanceSearch } from "./instance-search.js"
import { versionTenantsOf } from "./version-tenants.js"

/**
 * A version's tenant is the version's, never its instance's (F17): Camunda 7 runs a shared
 * definition (no tenant) with instances a tenant id provider gave a tenant, and resolves its calls
 * in the definition's tenant. Each pair: an instance row naming the tenant acme, the definition
 * row of its version naming none, or acme where the version is deployed in it.
 */

const VERSION = "invoice:1:s"
const ENDED = {
  id: "p1",
  processDefinitionId: VERSION,
  processDefinitionKey: "invoice",
  processDefinitionVersion: 1,
  state: "COMPLETED",
  endTime: "2026-11-27T09:00:00.000+0000",
}
const IN_ACME = { ...ENDED, tenantId: "acme" }
const definition = (tenantId: string | null) => [
  { id: VERSION, key: "invoice", version: 1, tenantId },
]

const missing: Route = () => {
  throw fakeFailure(404, "InvalidRequestException")
}

const definitionReads = (calls: readonly FakeCall[]) =>
  calls.filter(({ operationId }) => operationId === "getProcessDefinitions")

async function searched(row: object, tenantId: string | null) {
  const port = fakePort({
    queryHistoricProcessInstances: () => [row],
    getProcessDefinitions: () => definition(tenantId),
  })
  const page = await new InstanceSearch(port).search(
    { bpmnProcessId: BpmnProcessId("invoice") },
    { limit: 5 },
  )
  return { tenantId: page.items[0]?.definition.tenantId, reads: definitionReads(port.calls) }
}

async function inspected(row: object, tenantId: string | null) {
  const port = fakePort({
    getProcessInstance: missing,
    getHistoricProcessInstance: () => row,
    getProcessDefinitions: () => definition(tenantId),
  })
  const options = { variables: false, history: false, stacktrace: false }
  const view = instanceView(await loadInstanceData(port, "p1", options))
  return { tenantId: view.definition.tenantId, reads: definitionReads(port.calls) }
}

describe("the tenant of the version an instance runs", () => {
  it("is none in a search where a shared definition runs a tenant's instance, acme where deployed in it", async () => {
    const shared = await searched(IN_ACME, null)
    expect(shared.tenantId).toBeNull()
    expect(shared.reads.map(({ input }) => input.query.processDefinitionIdIn)).toEqual([VERSION])
    expect((await searched(IN_ACME, "acme")).tenantId).toBe("acme")
  })

  it("is none on an ended instance's view where its version is shared, acme where deployed in it", async () => {
    const shared = await inspected(IN_ACME, null)
    expect(shared.tenantId).toBeUndefined()
    expect(shared.reads).toHaveLength(1)
    expect((await inspected(IN_ACME, "acme")).tenantId).toBe("acme")
  })

  it("reads no definition where no instance names a tenant, as on an engine without tenants", async () => {
    const search = await searched(ENDED, null)
    expect(search).toEqual({ tenantId: null, reads: [] })
    expect(await inspected(ENDED, null)).toEqual({ tenantId: undefined, reads: [] })
    expect(await versionTenantsOf(fakePort({}), [ENDED])).toEqual(new Map())
  })
})
