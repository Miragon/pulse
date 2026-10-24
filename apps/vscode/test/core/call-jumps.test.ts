import {
  BpmnProcessId,
  InstanceId,
  type CalledInstance,
  type InstanceDetail,
  type ProcessRuntime,
} from "../../src/contract/index.js"
import { PatchedRuntime } from "../../src/contract/fake/index.js"
import { describe, expect, test } from "vitest"
import { DefinitionPanel } from "../../src/core/panels/definition-panel.js"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import type { DefinitionView, InstanceView, PanelState } from "../../src/core/protocol/index.js"
import { panelFixture } from "./support/panel-fixture.js"

const DISPATCH = BpmnProcessId("pulse-dispatch")
const CALL_ACTIVITY = "Activity_PrintShippingLabel"

function definitionView(state: PanelState): DefinitionView {
  if (state.status !== "ready" || state.view.kind !== "definition") {
    throw new Error(`expected a ready definition view, got ${state.status}`)
  }
  return state.view
}

function instanceView(state: PanelState): InstanceView {
  if (state.status !== "ready" || state.view.kind !== "instance") {
    throw new Error(`expected a ready instance view, got ${state.status}`)
  }
  return state.view
}

function nothingDeployed(runtime: ProcessRuntime): ProcessRuntime {
  return new PatchedRuntime(runtime, {
    getCalledProcesses: async (definitionId) =>
      (await runtime.getCalledProcesses(definitionId)).map(({ elementId, bpmnProcessId }) => ({
        elementId,
        bpmnProcessId,
      })),
  })
}

function withCalledInstances(
  runtime: ProcessRuntime,
  change: (detail: InstanceDetail) => readonly CalledInstance[],
): ProcessRuntime {
  return new PatchedRuntime(runtime, {
    getInstanceDetail: async (instanceId) => {
      const detail = await runtime.getInstanceDetail(instanceId)
      return detail && { ...detail, calledInstances: change(detail) }
    },
  })
}

function parcels(detail: InstanceDetail): CalledInstance[] {
  const [label] = detail.calledInstances
  if (label === undefined) {
    throw new Error("the world calls label from dispatch")
  }
  return [
    { ...label, id: InstanceId("parcel-ok"), state: "completed" },
    label,
    { ...label, id: InstanceId("parcel-later") },
  ]
}

describe("jumping from a call activity in the definition view", () => {
  test("offers the called process and opens it at the version it starts", async () => {
    const fixture = panelFixture()
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: DISPATCH })
    await panel.handle({ type: "ready" })

    expect(definitionView(fixture.lastState()).calls).toEqual([
      { elementId: CALL_ACTIVITY, label: "Open called process Print label" },
    ])
    expect(fixture.calls.filter((call) => call === "getCalledProcesses")).toHaveLength(1)

    await panel.handle({ type: "openCall", elementId: CALL_ACTIVITY, toSide: true })

    expect(fixture.effects.openDefinition).toHaveBeenCalledWith("pulse-label", "pulse-label:1", {
      toSide: true,
    })
  })

  test("asks the engine only when the diagram has call activities", async () => {
    const fixture = panelFixture()
    const panel = new DefinitionPanel(fixture.context, {
      bpmnProcessId: BpmnProcessId("pulse-order"),
    })

    await panel.handle({ type: "ready" })

    expect(definitionView(fixture.lastState()).calls).toEqual([])
    expect(fixture.calls).not.toContain("getCalledProcesses")
  })

  test("draws a process that is not deployed as missing and explains it in a strip on click", async () => {
    const fixture = panelFixture(nothingDeployed)
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: DISPATCH })
    await panel.handle({ type: "ready" })

    expect(definitionView(fixture.lastState()).calls).toEqual([
      { elementId: CALL_ACTIVITY, label: "pulse-label isn't deployed on local", missing: true },
    ])

    await panel.handle({ type: "openCall", elementId: CALL_ACTIVITY, toSide: false })

    expect(fixture.effects.openDefinition).not.toHaveBeenCalled()
    expect(definitionView(fixture.lastState()).notices).toContainEqual({
      tone: "info",
      title: "pulse-label isn't deployed on local.",
      actions: [],
    })

    await panel.handle({ type: "refresh" })

    expect(definitionView(fixture.lastState()).notices).toEqual([])
  })

  test("ignores an element that calls nothing it knows", async () => {
    const fixture = panelFixture()
    const panel = new DefinitionPanel(fixture.context, { bpmnProcessId: DISPATCH })
    await panel.handle({ type: "openCall", elementId: CALL_ACTIVITY, toSide: false })
    await panel.handle({ type: "ready" })

    await panel.handle({ type: "openCall", elementId: "Event_OrderDispatched", toSide: false })

    expect(fixture.effects.openDefinition).not.toHaveBeenCalled()
    expect(fixture.effects.openInstance).not.toHaveBeenCalled()
  })
})

describe("jumping from a call activity in the instance view", () => {
  test("opens the one called instance", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["DSP-3001"])
    await panel.handle({ type: "ready" })

    expect(instanceView(fixture.lastState()).calls).toEqual([
      {
        elementId: CALL_ACTIVITY,
        label: "Open called instance pulse-label fake-label-of-DSP-3001",
      },
    ])

    await panel.handle({ type: "openCall", elementId: CALL_ACTIVITY, toSide: true })

    expect(fixture.effects.openInstance).toHaveBeenCalledWith("fake-label-of-DSP-3001", {
      toSide: true,
    })
  })

  test("lets the user choose one of several called instances, incidents first", async () => {
    const fixture = panelFixture((runtime) => withCalledInstances(runtime, parcels))
    fixture.effects.pickInstance.mockResolvedValue(InstanceId("parcel-later"))
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["DSP-3001"])
    await panel.handle({ type: "ready" })

    expect(instanceView(fixture.lastState()).calls).toEqual([
      { elementId: CALL_ACTIVITY, label: "Choose one of 3 called instances" },
    ])

    await panel.handle({ type: "openCall", elementId: CALL_ACTIVITY, toSide: false })

    expect(fixture.effects.pickInstance).toHaveBeenCalledWith(
      "3 instances called from Print shipping label",
      [
        {
          instanceId: "fake-label-of-DSP-3001",
          label: "pulse-label fake-label-of-DSP-3001",
          description: "Running · with incident",
        },
        { instanceId: "parcel-ok", label: "pulse-label parcel-ok", description: "Completed" },
        {
          instanceId: "parcel-later",
          label: "pulse-label parcel-later",
          description: "Running",
        },
      ],
    )
    expect(fixture.effects.openInstance).toHaveBeenCalledWith("parcel-later", { toSide: false })
  })

  test("opens nothing when the choice is dismissed", async () => {
    const fixture = panelFixture((runtime) => withCalledInstances(runtime, parcels))
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["DSP-3001"])
    await panel.handle({ type: "ready" })

    await panel.handle({ type: "openCall", elementId: CALL_ACTIVITY, toSide: false })

    expect(fixture.effects.openInstance).not.toHaveBeenCalled()
  })

  test("opens the called process when nothing was called yet", async () => {
    const fixture = panelFixture((runtime) => withCalledInstances(runtime, () => []))
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["DSP-3001"])
    await panel.handle({ type: "ready" })

    expect(instanceView(fixture.lastState()).calls).toEqual([
      { elementId: CALL_ACTIVITY, label: "Not called yet – open called process Print label" },
    ])

    await panel.handle({ type: "openCall", elementId: CALL_ACTIVITY, toSide: false })

    expect(fixture.effects.openDefinition).toHaveBeenCalledWith("pulse-label", "pulse-label:1", {
      toSide: false,
    })
  })

  test("explains in a strip that the called process is not deployed", async () => {
    const fixture = panelFixture((runtime) =>
      withCalledInstances(nothingDeployed(runtime), () => []),
    )
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["DSP-3001"])
    await panel.handle({ type: "ready" })

    await panel.handle({ type: "openCall", elementId: CALL_ACTIVITY, toSide: false })

    expect(instanceView(fixture.lastState()).notice?.title).toBe(
      "pulse-label isn't deployed on local.",
    )

    await panel.handle({ type: "refresh" })

    expect(instanceView(fixture.lastState()).notice).toBeUndefined()
  })

  test("links a called instance back to the instance that called it", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, InstanceId("fake-label-of-DSP-3001"))

    await panel.handle({ type: "ready" })

    expect(instanceView(fixture.lastState()).instance.parent).toEqual({
      instanceId: "fake-DSP-3001",
      label: "from fake-DSP-3001",
    })
  })
})
