import { BpmnProcessId, DefinitionId, RuntimeError } from "../../src/contract/index.js"
import { NEUTRAL_DIAGRAMS } from "../../src/contract/conformance/index.js"
import { FakeEngine, FakeWorld, PatchedRuntime } from "../../src/contract/fake/index.js"
import { describe, expect, test } from "vitest"
import { BpmnProcessIds } from "../../src/core/bpmn/bpmn-process-ids.js"
import { ElementNames } from "../../src/core/bpmn/element-names.js"
import { DefinitionPanel } from "../../src/core/panels/definition-panel.js"
import type { DefinitionView, PanelState } from "../../src/core/protocol/index.js"
import { panelFixture } from "./support/panel-fixture.js"

const ORDER = BpmnProcessId("pulse-order")

function readyView(state: PanelState): DefinitionView {
  if (state.status !== "ready" || state.view.kind !== "definition") {
    throw new Error(`expected a ready definition view, got ${state.status}`)
  }
  return state.view
}

describe("element names from the deployed model", () => {
  test("are read from the BPMN XML, whatever the attribute order", () => {
    const names = ElementNames.of(NEUTRAL_DIAGRAMS.order)
    expect(names.get("Activity_ChargePayment")).toBe("Charge payment")
    expect(ElementNames.of('<task name="A &amp; B" id="T1"/>').get("T1")).toBe("A & B")
  })

  test("include the ids of the processes in a file", () => {
    expect(BpmnProcessIds.of(NEUTRAL_DIAGRAMS.order)).toEqual(["pulse-order"])
    expect(
      BpmnProcessIds.of('<process id="a"/><bpmn2:process isExecutable="true" id="b">'),
    ).toEqual(["a", "b"])
  })
})

describe("the drift between the open file and the engine", () => {
  test("selects the version the file matches and says so", async () => {
    const fixture = panelFixture()
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: ORDER,
      localModel: { fileName: "order.bpmn", xml: `  ${NEUTRAL_DIAGRAMS.order}\r\n` },
    })

    await panel.handle({ type: "ready" })

    const view = readyView(fixture.lastState())
    expect(view.selectedDefinitionId).toBe(fixture.world.definitionIds["order@2"])
    expect(view.notices[0]).toEqual({
      tone: "info",
      title: "order.bpmn matches the deployed v2.",
      actions: [],
    })
  })

  test("warns when the file matches no deployed version", async () => {
    const fixture = panelFixture()
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: ORDER,
      localModel: {
        fileName: "order.bpmn",
        xml: NEUTRAL_DIAGRAMS.order.replace("Review order", "Check order"),
      },
    })

    await panel.handle({ type: "ready" })

    expect(readyView(fixture.lastState()).notices[0]).toMatchObject({
      tone: "warning",
      title: "order.bpmn differs from every deployed version.",
    })
  })

  test("points at the newest version when the file matches an older one", async () => {
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          getDiagramXml: async (definitionId) =>
            definitionId === "pulse-order:2"
              ? `${await runtime.getDiagramXml(definitionId)}<!-- v2 -->`
              : runtime.getDiagramXml(definitionId),
        }),
    )
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: ORDER,
      localModel: { fileName: "order.bpmn", xml: NEUTRAL_DIAGRAMS.order },
    })

    await panel.handle({ type: "ready" })

    const view = readyView(fixture.lastState())
    expect(view.selectedDefinitionId).toBe("pulse-order:1")
    expect(view.notices[0]).toMatchObject({
      tone: "warning",
      title: "order.bpmn matches v1, but a newer version is deployed.",
      actions: [{ kind: "selectVersion", definitionId: "pulse-order:2" }],
    })
  })

  test("says when the file is not deployed at all", async () => {
    const fixture = panelFixture()
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: BpmnProcessId("new-process"),
      localModel: { fileName: "new.bpmn", xml: "<definitions/>" },
    })

    await panel.handle({ type: "ready" })

    expect(fixture.lastState()).toMatchObject({
      status: "failed",
      problem: { title: "new.bpmn is not deployed on local." },
    })
  })

  test("starts with the filter it was opened with", async () => {
    const fixture = panelFixture()
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: ORDER,
      definitionId: fixture.world.definitionIds["order@1"],
      filter: { scope: "withIncident", elementId: "Activity_ChargePayment" },
    })

    await panel.handle({ type: "ready" })

    expect(readyView(fixture.lastState()).instances.map((row) => row.businessKey)).toEqual([
      "ORD-1002",
    ])
  })

  test("a failing diagram fetch for an old version does not hide the panel", async () => {
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          getDiagramXml: (definitionId) =>
            definitionId === "pulse-order:1"
              ? Promise.reject(new RuntimeError("engineFailure", "HTTP 500"))
              : runtime.getDiagramXml(definitionId),
        }),
    )
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: ORDER,
      localModel: { fileName: "order.bpmn", xml: "<changed/>" },
    })

    await panel.handle({ type: "ready" })

    const view = readyView(fixture.lastState())
    expect(view.selectedVersion).toBe(2)
    expect(view.notices[0]).toMatchObject({
      tone: "warning",
      title: "Couldn't compare order.bpmn with the deployed versions.",
    })
  })

  test("compares again on every refresh, so a new deployment is recognised", async () => {
    const { state, world } = FakeWorld.seed()
    const local = {
      fileName: "order.bpmn",
      xml: NEUTRAL_DIAGRAMS.order.replace("Review order", "Check order"),
    }
    let current = state
    const fixture = panelFixture(
      () =>
        new PatchedRuntime(new FakeEngine(state), {
          listVersions: (id) => new FakeEngine(current).listVersions(id),
          getDiagramXml: (id) => new FakeEngine(current).getDiagramXml(id),
          getElementStatistics: (id) => new FakeEngine(current).getElementStatistics(id),
          searchInstances: (filter, page) => new FakeEngine(current).searchInstances(filter, page),
        }),
    )
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: ORDER, localModel: local })
    await panel.handle({ type: "ready" })
    expect(readyView(fixture.lastState()).notices[0]?.title).toBe(
      "order.bpmn differs from every deployed version.",
    )

    const order2 = state.definitions.find(
      (definition) => definition.ref.id === world.definitionIds["order@2"],
    )
    if (order2 === undefined) {
      throw new Error("the world has order v2")
    }
    const v3 = {
      ...order2,
      ref: { ...order2.ref, id: DefinitionId("pulse-order:3"), version: 3 },
      xml: local.xml,
    }
    current = { ...state, definitions: [...state.definitions, v3] }
    await panel.handle({ type: "refresh" })

    const view = readyView(fixture.lastState())
    expect(view.selectedVersion).toBe(3)
    expect(view.notices[0]?.title).toBe("order.bpmn matches the deployed v3.")
  })

  test("takes a fresh copy of the file when asked to compare again", async () => {
    const fixture = panelFixture()
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: ORDER,
      localModel: { fileName: "order.bpmn", xml: "<changed/>" },
    })
    await panel.handle({ type: "ready" })

    await panel.compareWith({ fileName: "order.bpmn", xml: NEUTRAL_DIAGRAMS.order })

    expect(readyView(fixture.lastState()).notices[0]?.title).toBe(
      "order.bpmn matches the deployed v2.",
    )
  })
})
