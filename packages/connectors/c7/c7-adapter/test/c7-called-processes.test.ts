import { DefinitionId } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { fakeRuntime } from "./support/fake-engine.js"
import { definitionsNamed } from "./support/definitions-route.js"
import { engineFailure, type RestRoute } from "./support/fake-engine-rest.js"
import { fixture, WORLD_IDS, worldDiagram } from "./support/fixtures.js"

const INVOICE_V1 = "invoice:1:61c3f9a0-cd7f-11f1-86d2-667bc3771e0d"
const INVOICE_V2 = "invoice:2:62318889-cd7f-11f1-86d2-667bc3771e0d"
const REVIEW_V1 = "ReviewInvoice:1:61c4bcf2-cd7f-11f1-86d2-667bc3771e0d"

const CALLED_BY_BINDINGS = definitionsNamed("keysIn", ["invoice", "ReviewInvoice", "refund"])

function xmlRoute(definitionId: string, bpmn20Xml: string): RestRoute {
  return {
    route: `GET /process-definition/${encodeURIComponent(definitionId)}/xml`,
    answer: { id: definitionId, bpmn20Xml },
  }
}

function ref(id: string, bpmnProcessId: string, version: number, name: string) {
  return { id, bpmnProcessId, tenantId: null, version, name }
}

describe("the processes a C7 call activity calls", () => {
  test("names the latest deployed version of the called process", async () => {
    const { runtime, engine } = fakeRuntime([
      xmlRoute(WORLD_IDS.dispatch1, worldDiagram("dispatch")),
      definitionsNamed("keysIn", ["pulse-label"]),
    ])

    const calls = await runtime.getCalledProcesses({
      id: DefinitionId(WORLD_IDS.dispatch1),
      tenantId: null,
    })

    expect(calls).toEqual([
      {
        elementId: "Activity_PrintShippingLabel",
        bpmnProcessId: "pulse-label",
        tenantId: null,
        definition: ref(WORLD_IDS.label1, "pulse-label", 1, "Print label"),
      },
    ])
    expect(engine.requests).toHaveLength(2)
  })

  test("resolves each binding and skips what only an expression decides", async () => {
    const { runtime } = fakeRuntime([
      xmlRoute(INVOICE_V1, fixture("call-bindings.bpmn")),
      CALLED_BY_BINDINGS,
      definitionsNamed("processDefinitionIdIn", [INVOICE_V1]),
    ])

    const calls = await runtime.getCalledProcesses({ id: DefinitionId(INVOICE_V1), tenantId: null })

    expect(calls).toEqual([
      {
        elementId: "Activity_LatestInvoice",
        bpmnProcessId: "invoice",
        tenantId: null,
        definition: ref(INVOICE_V2, "invoice", 2, "Invoice Receipt"),
      },
      {
        elementId: "Activity_SameDeployment",
        bpmnProcessId: "ReviewInvoice",
        tenantId: null,
        definition: ref(REVIEW_V1, "ReviewInvoice", 1, "Review Invoice"),
      },
      {
        elementId: "Activity_VersionOne",
        bpmnProcessId: "invoice",
        tenantId: null,
        definition: ref(INVOICE_V1, "invoice", 1, "Invoice Receipt"),
      },
      {
        elementId: "Activity_Tagged",
        bpmnProcessId: "invoice",
        tenantId: null,
        definition: ref(INVOICE_V2, "invoice", 2, "Invoice Receipt"),
      },
      { elementId: "Activity_NotDeployed", bpmnProcessId: "refund", tenantId: null },
    ])
  })

  test("finds nothing deployed with the caller when the binding asks for its deployment", async () => {
    const { runtime } = fakeRuntime([
      xmlRoute(INVOICE_V2, fixture("call-bindings.bpmn")),
      CALLED_BY_BINDINGS,
      definitionsNamed("processDefinitionIdIn", [INVOICE_V2]),
    ])

    const calls = await runtime.getCalledProcesses({ id: DefinitionId(INVOICE_V2), tenantId: null })

    expect(calls.find((call) => call.elementId === "Activity_SameDeployment")).toEqual({
      elementId: "Activity_SameDeployment",
      bpmnProcessId: "ReviewInvoice",
      tenantId: null,
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
    ])

    expect(
      await runtime.getCalledProcesses({ id: DefinitionId("nope:1:x"), tenantId: null }),
    ).toEqual([])
  })
})
