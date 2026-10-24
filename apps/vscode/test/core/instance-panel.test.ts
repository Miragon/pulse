import { PatchedRuntime } from "../../src/contract/fake/index.js"
import { InstanceId, RuntimeError, type ProcessRuntime } from "../../src/contract/index.js"
import { describe, expect, test } from "vitest"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import type { InstanceView, PanelState } from "../../src/core/protocol/index.js"
import { panelFixture } from "./support/panel-fixture.js"

function readyView(state: PanelState): InstanceView {
  if (state.status !== "ready" || state.view.kind !== "instance") {
    throw new Error(`expected a ready instance view, got ${state.status}`)
  }
  return state.view
}

function truncatingDetails(runtime: ProcessRuntime): ProcessRuntime {
  return new PatchedRuntime(runtime, {
    getInstanceDetail: async (instanceId) => {
      const detail = await runtime.getInstanceDetail(instanceId)
      return (
        detail && {
          ...detail,
          incidents: detail.incidents.map((incident) => ({
            ...incident,
            details: { kind: "stacktrace", text: "org.example.Wrapper: outer", truncated: true },
          })),
        }
      )
    },
  })
}

describe("the instance panel", () => {
  test("marks the call activity whose called instance holds the incident", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["DSP-3001"])

    await panel.handle({ type: "ready" })

    const view = readyView(fixture.lastState())
    expect(view.markers).toEqual([
      { elementId: "Activity_PrintShippingLabel", kind: "incidentInCalledInstance" },
      { elementId: "Event_DispatchRequested", kind: "completed" },
      { elementId: "Flow_DispatchRequestedToPrintShippingLabel", kind: "taken" },
    ])
    expect(view.incidents[0]?.inCalledInstance).toEqual({
      instanceId: "fake-label-of-DSP-3001",
      shortId: "fake-label-of-DSP-3001",
      bpmnProcessId: "pulse-label",
    })
    expect(view.waitStates[0]?.calledInstance?.instanceId).toBe("fake-label-of-DSP-3001")
  })

  test("puts a single incident with the root cause from the complete stacktrace on its card, without a strip", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])

    await panel.handle({ type: "ready" })

    const view = readyView(fixture.lastState())
    expect(view.headline).toBeUndefined()
    expect(view.markers).toEqual([
      { elementId: "Activity_ChargePayment", kind: "incident" },
      { elementId: "Event_OrderReceived", kind: "completed" },
      { elementId: "Gateway_Route", kind: "completed" },
      { elementId: "Flow_RouteToChargePayment", kind: "taken" },
      { elementId: "Flow_OrderReceivedToRoute", kind: "taken" },
    ])
    expect(view.incidents[0]).toMatchObject({
      typeLabel: "Failed task",
      detailsLabel: "Stacktrace",
      rootCause: "MissingBean: Cannot resolve identifier",
    })
  })

  test("loads with two engine calls when the details are complete", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])

    await panel.handle({ type: "ready" })

    expect(fixture.calls.sort()).toEqual(["getDiagramXml", "getInstanceDetail"])
  })

  test("never derives a root cause from truncated details but fetches the complete ones", async () => {
    const fixture = panelFixture(truncatingDetails)
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])

    await panel.handle({ type: "ready" })

    const view = readyView(fixture.lastState())
    expect(fixture.calls).toContain("getIncidentDetails")
    expect(view.incidents[0]?.rootCause).toBe("MissingBean: Cannot resolve identifier")
  })

  test("marks where a running instance waits and shows its variables", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1001"])

    await panel.handle({ type: "ready" })

    const view = readyView(fixture.lastState())
    expect(view.markers).toEqual([
      { elementId: "Activity_ReviewOrder", kind: "waiting" },
      { elementId: "Event_OrderReceived", kind: "completed" },
      { elementId: "Gateway_Route", kind: "completed" },
      { elementId: "Flow_RouteToReviewOrder", kind: "taken" },
      { elementId: "Flow_OrderReceivedToRoute", kind: "taken" },
    ])
    expect(view.path.map((row) => [row.elementId, row.state, row.duration])).toEqual([
      ["Event_OrderReceived", "completed", "1.0 s"],
      ["Gateway_Route", "completed", "1.0 s"],
      ["Activity_ReviewOrder", "active", undefined],
    ])
    expect(view.headline).toBeUndefined()
    expect(view.waitStates).toEqual([
      { elementId: "Activity_ReviewOrder", kindLabel: "User task", detail: "Assigned to demo" },
    ])
    expect(view.variables).toEqual([
      { name: "route", type: "String", valueJson: '"review"', truncated: false },
      {
        name: "reviewNote",
        type: "String",
        valueJson: '"Check the delivery address"',
        truncated: false,
        scopeElementId: "Activity_ReviewOrder",
      },
    ])
  })

  test("tells that an ended instance has ended", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1003"])

    await panel.handle({ type: "ready" })

    expect(readyView(fixture.lastState()).headline).toEqual({
      tone: "info",
      title: "This instance is completed.",
      actions: [],
    })
  })

  test("reports an unknown instance as not found", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(
      fixture.context,
      InstanceId("11111111-2222-3333-4444-555555555555"),
    )

    await panel.handle({ type: "ready" })

    expect(fixture.lastState()).toMatchObject({
      status: "failed",
      problem: { title: "The instance 11111111… was not found." },
    })
  })

  test("opens the complete incident details as a document", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])

    await panel.handle({
      type: "openIncidentDetails",
      incidentId: "incident-of-fake-ORD-1002",
    })

    expect(fixture.effects.showIncidentDetails).toHaveBeenCalledWith(
      "Incident incident-of-fake-ORD-1002",
      expect.objectContaining({ kind: "stacktrace", truncated: false }),
    )
  })

  test("reports missing incident details instead of opening an empty document", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])

    await panel.handle({ type: "openIncidentDetails", incidentId: "unknown" })

    expect(fixture.effects.showIncidentDetails).not.toHaveBeenCalled()
    expect(fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "The details of incident unknown was not found." }),
    )
  })

  test("keeps the last view when a refresh fails", async () => {
    let failing = false
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: (instanceId) =>
            failing
              ? Promise.reject(new RuntimeError("engineFailure", "HTTP 500"))
              : runtime.getInstanceDetail(instanceId),
        }),
    )
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1001"])
    await panel.handle({ type: "ready" })
    failing = true

    await panel.handle({ type: "refresh" })

    expect(fixture.lastState()).toMatchObject({
      status: "failed",
      problem: { title: "local failed to answer.", canEditConnection: false },
      staleView: { kind: "instance" },
    })
  })

  test("fails readably when the engine has no diagram for the version", async () => {
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          getDiagramXml: () => Promise.resolve(undefined),
        }),
    )
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1001"])

    await panel.handle({ type: "ready" })

    expect(fixture.lastState()).toMatchObject({
      status: "failed",
      problem: { title: "local answered in an unexpected way." },
    })
  })

  test("reports a failing details request instead of throwing", async () => {
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          getIncidentDetails: () => Promise.reject(new RuntimeError("unreachable", "gone")),
        }),
    )
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])

    await panel.handle({ type: "openIncidentDetails", incidentId: "incident-of-fake-ORD-1002" })

    expect(fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Can't reach local." }),
    )
  })

  test("copies a handover with the incident facts and without variables", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["DSP-3001"])
    await panel.handle({ type: "ready" })

    await panel.handle({ type: "copyHandover" })

    const [text, label] = fixture.effects.copyToClipboard.mock.calls[0] as [string, string]
    expect(label).toBe("handover")
    expect(text).toContain("### DSP-3001 · Dispatch order v1")
    expect(text).toContain("Engine: local (local, localhost)")
    expect(text).toContain(
      "- **Failed task** at `Activity_RenderLabel` since 2026-10-21 08:00:02 UTC",
    )
    expect(text).toContain("  - Root cause: MissingBean: Cannot resolve identifier")
    expect(text).toContain("  - In called instance `fake-label-of-DSP-3001` of pulse-label")
    expect(text).not.toContain("orderId")
  })

  test("copies nothing before the instance is loaded", async () => {
    const fixture = panelFixture()
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1001"])

    await panel.handle({ type: "copyHandover" })

    expect(fixture.effects.copyToClipboard).not.toHaveBeenCalled()
  })
})
