import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, it } from "vitest"
import { type FakeCall, fakeFailure, fakePort, type Route } from "../testing/fake-port.js"
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
  tenantId: null,
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

/** The versions of `definitions` a definitions read names by their keys or ids. */
function definitionsOf(definitions: readonly { id: string; key: string }[]): Route {
  return ({ query }) => {
    const keys = query.keysIn?.split(",")
    const ids = query.processDefinitionIdIn?.split(",")
    return definitions.filter(
      (definition) =>
        (keys === undefined || keys.includes(definition.key)) &&
        (ids === undefined || ids.includes(definition.id)),
    )
  }
}

function callsOf(
  xml: string,
  caller = CALLER.id,
  definitions: readonly { id: string; key: string }[] = DEFINITIONS,
) {
  const port = fakePort({
    getProcessDefinitionBpmn20Xml: () => ({ id: caller, bpmn20Xml: xml }),
    getProcessDefinitions: definitionsOf(definitions),
  })
  return {
    port,
    calls: new CalledProcessReader(port).read({ id: DefinitionId(caller), tenantId: null }),
  }
}

/** The query of each definitions read `port` sent. */
function definitionQueries(port: { readonly calls: readonly FakeCall[] }) {
  return port.calls
    .filter((call) => call.operationId === "getProcessDefinitions")
    .map((call) => call.input.query)
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
      {
        elementId: "Call_Latest",
        bpmnProcessId: "invoice",
        tenantId: null,
        definition: ref(INVOICE_3),
      },
      {
        elementId: "Call_Unprefixed",
        bpmnProcessId: "invoice",
        tenantId: null,
        definition: ref(INVOICE_3),
      },
      {
        elementId: "Call_Deployment",
        bpmnProcessId: "ReviewInvoice",
        tenantId: null,
        definition: ref(REVIEW_1),
      },
      {
        elementId: "Call_Version",
        bpmnProcessId: "invoice",
        tenantId: null,
        definition: ref(INVOICE_2),
      },
      {
        elementId: "Call_Tagged",
        bpmnProcessId: "invoice",
        tenantId: null,
        definition: ref(INVOICE_1),
      },
    ])
  })

  it("reads the versions of the called processes alone, and the caller's where a call binds to its deployment", async () => {
    const { port, calls } = callsOf(
      xmlOf(
        '<bpmn:callActivity id="Call_Latest" calledElement="invoice" />',
        '<bpmn:callActivity id="Call_Again" calledElement="invoice" />',
        '<bpmn:callActivity id="Call_Deployment" calledElement="ReviewInvoice" camunda:calledElementBinding="deployment" />',
      ),
    )
    await calls
    const order = { sortBy: "id", sortOrder: "asc", firstResult: "0", maxResults: "500" }
    expect(definitionQueries(port)).toStrictEqual([
      { keysIn: "invoice,ReviewInvoice", ...order },
      { processDefinitionIdIn: CALLER.id, ...order },
    ])
    const latest = callsOf(xmlOf('<bpmn:callActivity id="Call" calledElement="invoice" />'))
    await latest.calls
    expect(definitionQueries(latest.port)).toStrictEqual([{ keysIn: "invoice", ...order }])
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
      { elementId: "Call_NotDeployed", bpmnProcessId: "refund", tenantId: null },
      { elementId: "Call_NoSuchVersion", bpmnProcessId: "invoice", tenantId: null },
      { elementId: "Call_NoSuchTag", bpmnProcessId: "invoice", tenantId: null },
      { elementId: "Call_OtherDeployment", bpmnProcessId: "lonely", tenantId: null },
    ])
  })

  it("starts nothing by deployment for a caller without one, nor for a caller the engine does not list", async () => {
    const xml = xmlOf(
      '<bpmn:callActivity id="Call_Lonely" calledElement="lonely" camunda:calledElementBinding="deployment" />',
      '<bpmn:callActivity id="Call_Review" calledElement="ReviewInvoice" camunda:calledElementBinding="deployment" />',
    )
    const unbound = [
      { elementId: "Call_Lonely", bpmnProcessId: "lonely", tenantId: null },
      { elementId: "Call_Review", bpmnProcessId: "ReviewInvoice", tenantId: null },
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
      {
        elementId: "Call_Kept",
        bpmnProcessId: "invoice",
        tenantId: null,
        definition: ref(INVOICE_3),
      },
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
      {
        elementId: "Call_Inch",
        bpmnProcessId: "invoice",
        tenantId: null,
        definition: ref(INVOICE_3),
      },
      {
        elementId: "Call_Review",
        bpmnProcessId: "ReviewInvoice",
        tenantId: null,
        definition: ref(REVIEW_2),
      },
    ])
  })

  it("reads the XML through the runtime's read where one is given", async () => {
    const port = fakePort({ getProcessDefinitions: definitionsOf(DEFINITIONS) })
    const asked: string[] = []
    const reader = new CalledProcessReader(port, (id) => {
      asked.push(id)
      return Promise.resolve(
        xmlOf('<bpmn:callActivity id="Call_Review" calledElement="ReviewInvoice" />'),
      )
    })
    expect(await reader.read({ id: DefinitionId(CALLER.id), tenantId: null })).toStrictEqual([
      {
        elementId: "Call_Review",
        bpmnProcessId: "ReviewInvoice",
        tenantId: null,
        definition: ref(REVIEW_2),
      },
    ])
    expect(asked).toEqual([CALLER.id])
    expect(port.calls.map((call) => call.operationId)).toEqual(["getProcessDefinitions"])
  })

  it("reads no version for a version that calls nothing", async () => {
    const { port, calls } = callsOf(xmlOf())
    expect(await calls).toEqual([])
    expect(port.calls).toEqual([
      {
        operationId: "getProcessDefinitionBpmn20Xml",
        input: { pathArgs: [CALLER.id], query: {} },
      },
    ])
  })

  it("has no calls for a version the engine does not know, and reads no version", async () => {
    const port = fakePort({
      getProcessDefinitionBpmn20Xml: () => {
        throw fakeFailure(404, "InvalidRequestException")
      },
    })
    expect(
      await new CalledProcessReader(port).read({ id: DefinitionId("nope:1:x"), tenantId: null }),
    ).toEqual([])
    expect(port.calls.map((call) => call.operationId)).toEqual(["getProcessDefinitionBpmn20Xml"])
  })

  it("has no calls for an id no engine assigns, which it never sends", async () => {
    const port = fakePort({})
    expect(
      await new CalledProcessReader(port).read({ id: DefinitionId("../x"), tenantId: null }),
    ).toEqual([])
    expect(port.calls).toEqual([])
  })

  it("rejects a failure of the versions' read as it is", async () => {
    const failure = fakeFailure(500, "ProcessEngineException")
    const port = fakePort({
      getProcessDefinitionBpmn20Xml: () => ({
        bpmn20Xml: xmlOf('<bpmn:callActivity id="Call" calledElement="invoice" />'),
      }),
      getProcessDefinitions: () => {
        throw failure
      },
    })
    await expect(
      new CalledProcessReader(port).read({ id: DefinitionId(CALLER.id), tenantId: null }),
    ).rejects.toBe(failure)
  })
})
