import { BpmnProcessId, TenantId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort } from "../testing/fake-port.js"
import { DefinitionReader } from "./definition-reader.js"

/** "label" without a tenant, in "south" twice and in "north" once; the newest is south's. */
const LABEL = { id: "label:1:n", key: "label", version: 1, tenantId: null }
const NORTH_1 = { id: "label:1:a", key: "label", version: 1, tenantId: "north" }
const SOUTH_1 = { id: "label:1:b", key: "label", version: 1, tenantId: "south" }
const SOUTH_2 = { id: "label:2:c", key: "label", version: 2, tenantId: "south" }
const ALPHA = { id: "alpha:1:z", key: "alpha", version: 1, tenantId: "south" }

const STATISTICS = [
  {
    definition: SOUTH_2,
    instances: 4,
    incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
  },
  { definition: NORTH_1, instances: 2, incidents: [] },
  { definition: ALPHA, instances: 0, incidents: [] },
  { definition: LABEL, instances: 1, incidents: [] },
  { definition: SOUTH_1, instances: 3, incidents: [] },
]

/** Instances with an open incident: one on south's version 2, one on the label without a tenant. */
const WITH_INCIDENT = [
  { id: "p1", definitionId: SOUTH_2.id },
  { id: "p2", definitionId: LABEL.id },
]

function reader() {
  const port = fakePort({
    getProcessDefinitionStatistics: () => STATISTICS,
    getProcessInstances: () => WITH_INCIDENT,
  })
  return { port, reader: new DefinitionReader(port) }
}

const ref = ({ id, key, version, tenantId }: typeof NORTH_1 | typeof LABEL) => ({
  id,
  bpmnProcessId: key,
  tenantId,
  version,
})

describe("DefinitionReader in an engine with tenants", () => {
  it("lists a key once per tenant, by that tenant's latest, the one without a tenant first", async () => {
    const { reader: definitions } = reader()
    expect(await definitions.list()).toStrictEqual([
      { latest: ref(ALPHA), running: 0, withIncident: 0, incidents: 0 },
      { latest: ref(LABEL), running: 1, withIncident: 1, incidents: 0 },
      { latest: ref(NORTH_1), running: 2, withIncident: 0, incidents: 0 },
      { latest: ref(SOUTH_2), running: 7, withIncident: 1, incidents: 1 },
    ])
  })

  it("lists a process's versions in its tenant alone, with the same requests as without tenants", async () => {
    const { port, reader: definitions } = reader()
    const label = BpmnProcessId("label")
    const versionsIn = async (tenantId: TenantId | null) =>
      (await definitions.versions(label, tenantId)).map(({ definition }) => definition.id)

    expect(await versionsIn(TenantId("south"))).toEqual([SOUTH_2.id, SOUTH_1.id])
    expect(await versionsIn(TenantId("north"))).toEqual([NORTH_1.id])
    expect(await versionsIn(null)).toEqual([LABEL.id])
    expect(await versionsIn(TenantId("east"))).toEqual([])
    const queries = port.calls
      .filter((call) => call.operationId === "getProcessInstances")
      .map((call) => call.input.query.processDefinitionKey)
    expect(new Set(queries)).toEqual(new Set(["label"]))
  })
})
