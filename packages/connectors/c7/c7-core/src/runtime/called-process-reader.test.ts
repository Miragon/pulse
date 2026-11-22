import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { fakeFailure, fakePort } from "../testing/fake-port.js"
import { CalledProcessReader } from "./called-process-reader.js"

const CALLER = { id: "caller:1:c", key: "caller", version: 1, deploymentId: "d2" }
const INVOICE_1 = {
  id: "invoice:1:a",
  key: "invoice",
  version: 1,
  deploymentId: "d1",
  versionTag: "V1.0",
}
const INVOICE_2 = {
  id: "invoice:2:b",
  key: "invoice",
  version: 2,
  deploymentId: "d2",
  versionTag: "V2.0",
}
const INVOICE_3 = {
  id: "invoice:3:c",
  key: "invoice",
  version: 3,
  deploymentId: "d3",
  name: "Invoice",
}
const REVIEW_1 = { id: "ReviewInvoice:1:r", key: "ReviewInvoice", version: 1, deploymentId: "d2" }
const REVIEW_2 = { id: "ReviewInvoice:2:s", key: "ReviewInvoice", version: 2, deploymentId: "d3" }
const LONELY = { id: "lonely:1:l", key: "lonely", version: 1 }

/** Older versions first, so the reader must sort to find the latest. */
const DEFINITIONS = [INVOICE_1, INVOICE_3, CALLER, REVIEW_1, INVOICE_2, REVIEW_2, LONELY]

const ref = (definition: { id: string; key: string; version: number; name?: string }) => ({
  id: definition.id,
  bpmnProcessId: definition.key,
  version: definition.version,
  ...(definition.name === undefined ? {} : { name: definition.name }),
})

const xmlOf = (...tags: string[]) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn">',
    '<bpmn:process id="Process_Caller" isExecutable="true">',
    ...tags,
    "</bpmn:process>",
    "</bpmn:definitions>",
  ].join("\n")

function callsOf(xml: string, caller = CALLER.id, definitions: readonly object[] = DEFINITIONS) {
  const port = fakePort({
    getProcessDefinitionBpmn20Xml: () => ({ id: caller, bpmn20Xml: xml }),
    getProcessDefinitionStatistics: () =>
      definitions.map((definition) => ({ definition, instances: 0 })),
  })
  return { port, calls: new CalledProcessReader(port).read(DefinitionId(caller)) }
}

describe("CalledProcessReader", () => {
  it("names the version each binding starts", async () => {
    const { calls } = callsOf(
      xmlOf(
        '<bpmn:callActivity id="Call_Latest" name="" calledElement="invoice" />',
        '<callActivity id="Call_Unprefixed" calledElement="invoice" camunda:calledElementBinding="latest">',
        "</callActivity>",
        '<my-ns:callActivity id="Call_Deployment" calledElement="ReviewInvoice" camunda:calledElementBinding="deployment" />',
        '<bpmn:callActivity id="Call_Version" name="Version 2 > 1" calledElement="invoice" camunda:calledElementBinding="version" camunda:calledElementVersion="2" />',
        '<bpmn:callActivity id="Call_Tagged" calledElement="invoice" camunda:calledElementBinding="versionTag" camunda:calledElementVersionTag="V1.0" />',
      ),
    )
    expect(await calls).toStrictEqual([
      { elementId: "Call_Latest", bpmnProcessId: "invoice", definition: ref(INVOICE_3) },
      { elementId: "Call_Unprefixed", bpmnProcessId: "invoice", definition: ref(INVOICE_3) },
      { elementId: "Call_Deployment", bpmnProcessId: "ReviewInvoice", definition: ref(REVIEW_1) },
      { elementId: "Call_Version", bpmnProcessId: "invoice", definition: ref(INVOICE_2) },
      { elementId: "Call_Tagged", bpmnProcessId: "invoice", definition: ref(INVOICE_1) },
    ])
  })

  it("names the process without a version when the engine holds none the binding starts", async () => {
    const { calls } = callsOf(
      xmlOf(
        '<bpmn:callActivity id="Call_NotDeployed" calledElement="refund" />',
        '<bpmn:callActivity id="Call_NoSuchVersion" calledElement="invoice" camunda:calledElementBinding="version" camunda:calledElementVersion="12" />',
        '<bpmn:callActivity id="Call_NoSuchTag" calledElement="invoice" camunda:calledElementBinding="versionTag" camunda:calledElementVersionTag="V9.0" />',
        '<bpmn:callActivity id="Call_OtherDeployment" calledElement="lonely" camunda:calledElementBinding="deployment" />',
      ),
    )
    expect(await calls).toStrictEqual([
      { elementId: "Call_NotDeployed", bpmnProcessId: "refund" },
      { elementId: "Call_NoSuchVersion", bpmnProcessId: "invoice" },
      { elementId: "Call_NoSuchTag", bpmnProcessId: "invoice" },
      { elementId: "Call_OtherDeployment", bpmnProcessId: "lonely" },
    ])
  })

  it("starts nothing by deployment for a caller without one, nor for a caller the engine does not list", async () => {
    const xml = xmlOf(
      '<bpmn:callActivity id="Call_Lonely" calledElement="lonely" camunda:calledElementBinding="deployment" />',
      '<bpmn:callActivity id="Call_Review" calledElement="ReviewInvoice" camunda:calledElementBinding="deployment" />',
    )
    const unbound = [
      { elementId: "Call_Lonely", bpmnProcessId: "lonely" },
      { elementId: "Call_Review", bpmnProcessId: "ReviewInvoice" },
    ]
    const unlisted = callsOf(xml, LONELY.id, [LONELY, REVIEW_1])
    expect(await unlisted.calls).toStrictEqual(unbound)
    const unknown = callsOf(xml, "ghost:1:g", [LONELY, REVIEW_1])
    expect(await unknown.calls).toStrictEqual(unbound)
  })

  it("leaves out what only an expression decides and what names no whole version", async () => {
    const { calls } = callsOf(
      xmlOf(
        '<bpmn:callActivity id="Call_Expression" calledElement="${nextProcess}" />',
        '<bpmn:callActivity id="Call_Deferred" calledElement="#{nextProcess}" />',
        '<bpmn:callActivity id="Call_VersionExpression" calledElement="invoice" camunda:calledElementBinding="version" camunda:calledElementVersion="${version}" />',
        '<bpmn:callActivity id="Call_Fraction" calledElement="invoice" camunda:calledElementBinding="version" camunda:calledElementVersion="1.5" />',
        '<bpmn:callActivity id="Call_Named" calledElement="invoice" camunda:calledElementBinding="version" camunda:calledElementVersion="v1" />',
        '<bpmn:callActivity id="Call_NoVersion" calledElement="invoice" camunda:calledElementBinding="version" />',
        '<bpmn:callActivity id="Call_TagExpression" calledElement="invoice" camunda:calledElementBinding="versionTag" camunda:calledElementVersionTag="#{tag}" />',
        '<bpmn:callActivity id="Call_NoTag" calledElement="invoice" camunda:calledElementBinding="versionTag" />',
        '<bpmn:callActivity id="Call_Unknown" calledElement="invoice" camunda:calledElementBinding="foo" camunda:calledElementVersionTag="V1.0" />',
        '<bpmn:callActivity name="No id" calledElement="invoice" />',
        '<bpmn:callActivity id="Call_NoProcess" />',
        '<bpmn:callActivityGroup id="Not_A_Call" calledElement="invoice" />',
        '<bpmn:callActivity id="Call_Kept" calledElement="invoice" />',
      ),
    )
    expect(await calls).toStrictEqual([
      { elementId: "Call_Kept", bpmnProcessId: "invoice", definition: ref(INVOICE_3) },
    ])
  })

  it("hides no call behind a value that holds the other quote", async () => {
    const { calls } = callsOf(
      xmlOf(
        `<bpmn:callActivity id="Call_Inch" name='5" pipe' calledElement="invoice" />`,
        '<bpmn:callActivity id="Call_Review" calledElement="ReviewInvoice" />',
      ),
    )
    expect(await calls).toStrictEqual([
      { elementId: "Call_Inch", bpmnProcessId: "invoice", definition: ref(INVOICE_3) },
      { elementId: "Call_Review", bpmnProcessId: "ReviewInvoice", definition: ref(REVIEW_2) },
    ])
  })

  it("reads the XML through the runtime's read where one is given", async () => {
    const port = fakePort({
      getProcessDefinitionStatistics: () =>
        DEFINITIONS.map((definition) => ({ definition, instances: 0 })),
    })
    const asked: string[] = []
    const reader = new CalledProcessReader(port, (id) => {
      asked.push(id)
      return Promise.resolve(
        xmlOf('<bpmn:callActivity id="Call_Review" calledElement="ReviewInvoice" />'),
      )
    })
    expect(await reader.read(DefinitionId(CALLER.id))).toStrictEqual([
      { elementId: "Call_Review", bpmnProcessId: "ReviewInvoice", definition: ref(REVIEW_2) },
    ])
    expect(asked).toEqual([CALLER.id])
    expect(port.calls.map((call) => call.operationId)).toEqual(["getProcessDefinitionStatistics"])
  })

  it("reads the version's XML and the deployed versions, in parallel", async () => {
    const { port, calls } = callsOf(xmlOf())
    expect(await calls).toEqual([])
    expect(port.calls).toEqual([
      {
        operationId: "getProcessDefinitionBpmn20Xml",
        input: { pathArgs: [CALLER.id], query: {} },
      },
      {
        operationId: "getProcessDefinitionStatistics",
        input: { pathArgs: [], query: { rootIncidents: "true" } },
      },
    ])
  })

  it("has no calls for a version the engine does not know", async () => {
    const port = fakePort({
      getProcessDefinitionBpmn20Xml: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
      getProcessDefinitionStatistics: () => [],
    })
    expect(await new CalledProcessReader(port).read(DefinitionId("nope:1:x"))).toEqual([])
  })

  it("has no calls for an id no engine assigns, which it never sends", async () => {
    const port = fakePort({ getProcessDefinitionStatistics: () => [] })
    expect(await new CalledProcessReader(port).read(DefinitionId("../x"))).toEqual([])
    expect(port.calls.map((call) => call.operationId)).toEqual(["getProcessDefinitionStatistics"])
  })

  it("rejects a failure of the statistics as it is", async () => {
    const failure = fakeFailure(500, "ProcessEngineException")
    const port = fakePort({
      getProcessDefinitionBpmn20Xml: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
      getProcessDefinitionStatistics: () => {
        throw failure
      },
    })
    await expect(new CalledProcessReader(port).read(DefinitionId("nope:1:x"))).rejects.toBe(failure)
  })
})
