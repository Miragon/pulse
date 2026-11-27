import { DefinitionId, TenantId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakePort, type Route } from "../testing/fake-port.js"
import { CalledProcessReader } from "./called-process-reader.js"

/** The same key deployed without a tenant and in two tenants, the newest version in "south". */
const LABEL = { id: "label:1:n", key: "label", version: 1, deploymentId: "d0" }
const NORTH_LABEL = {
  id: "label:1:a",
  key: "label",
  version: 1,
  tenantId: "north",
  deploymentId: "d1",
  versionTag: "V1",
}
const SOUTH_LABEL_1 = { id: "label:1:b", key: "label", version: 1, tenantId: "south" }
const SOUTH_LABEL_2 = {
  id: "label:2:c",
  key: "label",
  version: 2,
  tenantId: "south",
  deploymentId: "d2",
  versionTag: "V1",
}
const NORTH_CALLER = {
  id: "dispatch:1:a",
  key: "dispatch",
  version: 1,
  tenantId: "north",
  deploymentId: "d1",
}
const DEFINITIONS = [SOUTH_LABEL_2, NORTH_LABEL, LABEL, SOUTH_LABEL_1, NORTH_CALLER]

const xmlOf = (...tags: string[]) =>
  [
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">',
    '<bpmn:process id="dispatch" isExecutable="true">',
    ...tags,
    "</bpmn:process>",
    "</bpmn:definitions>",
  ].join("\n")

const definitionsOf: Route = ({ query }) => {
  const keys = query.keysIn?.split(",")
  const ids = query.processDefinitionIdIn?.split(",")
  return DEFINITIONS.filter(
    (definition) =>
      (keys === undefined || keys.includes(definition.key)) &&
      (ids === undefined || ids.includes(definition.id)),
  )
}

function callsOf(xml: string, tenantId: string | null) {
  const port = fakePort({
    getProcessDefinitionBpmn20Xml: () => ({ id: NORTH_CALLER.id, bpmn20Xml: xml }),
    getProcessDefinitions: definitionsOf,
  })
  const caller = {
    id: DefinitionId(NORTH_CALLER.id),
    tenantId: tenantId === null ? null : TenantId(tenantId),
  }
  return { port, calls: new CalledProcessReader(port).read(caller) }
}

const call = (elementId: string, tenantId: string | null, definition?: { id: string }) => ({
  elementId,
  tenantId,
  definitionId: definition?.id,
})

async function described(calls: ReturnType<typeof callsOf>["calls"]) {
  return (await calls).map(({ elementId, tenantId, definition }) => ({
    elementId,
    tenantId,
    definitionId: definition?.id,
  }))
}

describe("CalledProcessReader in an engine with tenants", () => {
  it("resolves every binding in the caller's tenant, never another tenant's newer version", async () => {
    const { calls } = callsOf(
      xmlOf(
        '<bpmn:callActivity id="Call_Latest" calledElement="label" />',
        '<bpmn:callActivity id="Call_Version" calledElement="label" camunda:calledElementBinding="version" camunda:calledElementVersion="2" />',
        '<bpmn:callActivity id="Call_Tagged" calledElement="label" camunda:calledElementBinding="versionTag" camunda:calledElementVersionTag="V1" />',
      ),
      "north",
    )
    expect(await described(calls)).toEqual([
      call("Call_Latest", "north", NORTH_LABEL),
      call("Call_Version", "north"),
      call("Call_Tagged", "north", NORTH_LABEL),
    ])
  })

  it("resolves a caller without a tenant among the versions without one", async () => {
    const { calls } = callsOf(xmlOf('<bpmn:callActivity id="Call" calledElement="label" />'), null)
    expect(await described(calls)).toEqual([call("Call", null, LABEL)])
    expect((await calls)[0]?.definition).toStrictEqual({
      id: LABEL.id,
      bpmnProcessId: "label",
      tenantId: null,
      version: 1,
    })
  })

  it("resolves in the tenant a call names, an empty one the caller's, an expression's none", async () => {
    const { calls } = callsOf(
      xmlOf(
        '<bpmn:callActivity id="Call_South" calledElement="label" camunda:calledElementTenantId="south" />',
        '<bpmn:callActivity id="Call_Empty" calledElement="label" camunda:calledElementTenantId="" />',
        '<bpmn:callActivity id="Call_Expression" calledElement="label" camunda:calledElementTenantId="${tenant}" />',
        '<bpmn:callActivity id="Call_Elsewhere" calledElement="label" camunda:calledElementTenantId="east" />',
      ),
      "north",
    )
    expect(await described(calls)).toEqual([
      call("Call_South", "south", SOUTH_LABEL_2),
      call("Call_Empty", "north", NORTH_LABEL),
      call("Call_Elsewhere", "east"),
    ])
  })

  it("starts the version of the caller's deployment by its deployment alone, as the engine does", async () => {
    const { port, calls } = callsOf(
      xmlOf(
        '<bpmn:callActivity id="Call_Deployment" calledElement="label" camunda:calledElementBinding="deployment" />',
      ),
      "north",
    )
    expect(await described(calls)).toEqual([call("Call_Deployment", "north", NORTH_LABEL)])
    expect(port.calls.map((sent) => sent.input.query)).toContainEqual(
      expect.objectContaining({ processDefinitionIdIn: NORTH_CALLER.id }),
    )
  })
})
