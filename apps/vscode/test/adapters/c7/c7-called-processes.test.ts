import { DefinitionId } from "../../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { fakeRuntime } from "./support/fake-engine.js"
import { engineFailure, type RestRoute } from "./support/fake-engine-rest.js"
import { fixture, WORLD_IDS } from "./support/fixtures.js"

const INVOICE_V1 = "invoice:1:61c3f9a0-cd7f-11f1-86d2-667bc3771e0d"
const INVOICE_V2 = "invoice:2:62318889-cd7f-11f1-86d2-667bc3771e0d"
const REVIEW_V1 = "ReviewInvoice:1:61c4bcf2-cd7f-11f1-86d2-667bc3771e0d"

const DEFINITION_STATISTICS: RestRoute = {
  route: "GET /process-definition/statistics",
  answer: new Response(fixture("definition-statistics.json")),
}

function xmlRoute(definitionId: string, file: string): RestRoute {
  return {
    route: `GET /process-definition/${encodeURIComponent(definitionId)}/xml`,
    answer: { id: definitionId, bpmn20Xml: fixture(file) },
  }
}

function ref(id: string, bpmnProcessId: string, version: number, name: string) {
  return { id, bpmnProcessId, version, name }
}

describe("the processes a C7 call activity calls", () => {
  test("names the latest deployed version of the called process", async () => {
    const { runtime, engine } = fakeRuntime([
      xmlRoute(WORLD_IDS.dispatch1, "../world/dispatch.bpmn"),
      DEFINITION_STATISTICS,
    ])

    const calls = await runtime.getCalledProcesses(DefinitionId(WORLD_IDS.dispatch1))

    expect(calls).toEqual([
      {
        elementId: "Activity_PrintShippingLabel",
        bpmnProcessId: "pulse-label",
        definition: ref(WORLD_IDS.label1, "pulse-label", 1, "Print label"),
      },
    ])
    expect(engine.requests).toHaveLength(2)
  })

  test("resolves each binding and skips what only an expression decides", async () => {
    const { runtime } = fakeRuntime([
      xmlRoute(INVOICE_V1, "call-bindings.bpmn"),
      DEFINITION_STATISTICS,
    ])

    const calls = await runtime.getCalledProcesses(DefinitionId(INVOICE_V1))

    expect(calls).toEqual([
      {
        elementId: "Activity_LatestInvoice",
        bpmnProcessId: "invoice",
        definition: ref(INVOICE_V2, "invoice", 2, "Invoice Receipt"),
      },
      {
        elementId: "Activity_SameDeployment",
        bpmnProcessId: "ReviewInvoice",
        definition: ref(REVIEW_V1, "ReviewInvoice", 1, "Review Invoice"),
      },
      {
        elementId: "Activity_VersionOne",
        bpmnProcessId: "invoice",
        definition: ref(INVOICE_V1, "invoice", 1, "Invoice Receipt"),
      },
      {
        elementId: "Activity_Tagged",
        bpmnProcessId: "invoice",
        definition: ref(INVOICE_V2, "invoice", 2, "Invoice Receipt"),
      },
      { elementId: "Activity_NotDeployed", bpmnProcessId: "refund" },
    ])
  })

  test("finds nothing deployed with the caller when the binding asks for its deployment", async () => {
    const { runtime } = fakeRuntime([
      xmlRoute(INVOICE_V2, "call-bindings.bpmn"),
      DEFINITION_STATISTICS,
    ])

    const calls = await runtime.getCalledProcesses(DefinitionId(INVOICE_V2))

    expect(calls.find((call) => call.elementId === "Activity_SameDeployment")).toEqual({
      elementId: "Activity_SameDeployment",
      bpmnProcessId: "ReviewInvoice",
    })
  })

  test("has no calls for an unknown definition", async () => {
    const { runtime } = fakeRuntime([
      {
        route: `GET /process-definition/${encodeURIComponent("nope:1:x")}/xml`,
        answer: engineFailure(
          404,
          "InvalidRequestException",
          "No matching definition with id nope:1:00000000-0000-0000-0000-000000000000",
        ),
      },
      DEFINITION_STATISTICS,
    ])

    expect(await runtime.getCalledProcesses(DefinitionId("nope:1:x"))).toEqual([])
  })
})
