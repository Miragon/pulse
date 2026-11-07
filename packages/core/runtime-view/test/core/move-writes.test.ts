import { ElementId, RuntimeError, type ProcessCommands } from "../../src/contract/index.js"
import { describe, expect, test, vi } from "vitest"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import type { InstanceView, PanelState } from "../../src/core/protocol/index.js"
import { panelFixture, type FixtureOptions } from "./support/panel-fixture.js"

const CHARGE = "Activity_ChargePayment"
const REVIEW = "Activity_ReviewOrder"
const REASON = "Charged by hand after the outage"

function readyView(state: PanelState): InstanceView {
  if (state.status !== "ready" || state.view.kind !== "instance") {
    throw new Error(`expected a ready instance view, got ${state.status}`)
  }
  return state.view
}

async function openPanel(alias: "ORD-1001" | "ORD-1002" | "ORD-1003", options: FixtureOptions) {
  const fixture = panelFixture((runtime) => runtime, options)
  const panel = new InstancePanel(fixture.context, fixture.world.instanceIds[alias])
  await panel.handle({ type: "ready" })
  return { fixture, panel, view: () => readyView(fixture.lastState()) }
}

function spiedMoves(given: ProcessCommands) {
  return {
    ...given,
    retryIncident: (incidentId: Parameters<ProcessCommands["retryIncident"]>[0]) =>
      given.retryIncident(incidentId),
    setVariable: (...args: Parameters<ProcessCommands["setVariable"]>) =>
      given.setVariable(...args),
    moveToken: vi.fn((...args: Parameters<ProcessCommands["moveToken"]>) =>
      given.moveToken(...args),
    ),
  }
}

describe("moving a token on a read-only engine", () => {
  test("offers no move and ignores the intent", async () => {
    const { fixture, panel, view } = await openPanel("ORD-1002", {})

    expect(view().moves).toBeUndefined()
    expect(view().waitStates[0]).not.toHaveProperty("moveRefusal")

    await panel.handle({
      type: "moveToken",
      fromElementId: CHARGE,
      toElementId: REVIEW,
      reason: REASON,
    })

    expect(fixture.effects.confirmWrite).not.toHaveBeenCalled()
  })
})

describe("moving a token", () => {
  test("offers the waiting token with its targets and refusals", async () => {
    const { view } = await openPanel("ORD-1002", { writable: true })

    expect(view().waitStates[0]).not.toHaveProperty("moveRefusal")
    const [option] = view().moves ?? []
    expect(option?.fromLabel).toBe("Charge payment")
    expect(option?.targets.map((target) => target.elementId)).toEqual([
      "Gateway_Route",
      REVIEW,
      CHARGE,
    ])
    expect(option?.refused.map((refused) => refused.elementId)).toEqual([
      "Event_OrderReceived",
      "Event_OrderReviewed",
      "Event_PaymentCharged",
      "Event_ShippedExpress",
    ])
  })

  test("confirms what happens, moves exactly that token and reports where it waits now", async () => {
    let commands: ReturnType<typeof spiedMoves> | undefined
    const { fixture, panel, view } = await openPanel("ORD-1002", {
      writable: true,
      adaptCommands: (given) => (commands = spiedMoves(given)),
    })

    await panel.handle({
      type: "moveToken",
      fromElementId: CHARGE,
      toElementId: REVIEW,
      reason: ` ${REASON} `,
    })

    expect(fixture.effects.confirmWrite).toHaveBeenCalledWith({
      action: "moveToken",
      title: "Move the token from Charge payment to Review order?",
      facts: [
        "Instance ORD-1002 (fake-ORD-1002) · Order fulfillment v1",
        "Cancels Charge payment and closes its incident.",
        "Starts Review order, with its listeners and input mappings, and runs on to the next wait.",
        `Reason: ${REASON}`,
        "Data read just now",
        "This can't be undone.",
      ],
      confirmLabel: "Move",
    })
    expect(commands?.moveToken).toHaveBeenCalledWith(fixture.world.instanceIds["ORD-1002"], {
      fromElementId: ElementId(CHARGE),
      toElementId: ElementId(REVIEW),
      reason: REASON,
    })
    expect(fixture.effects.reportWritten).toHaveBeenCalledWith(
      "Moved the token from Charge payment to Review order on local (localhost).",
    )
    expect(view().write).toEqual({
      status: "done",
      target: { kind: "token", fromElementId: CHARGE },
    })
    expect(view().incidents).toEqual([])
    expect(view().outcome).toMatchObject({
      tone: "info",
      title: "Moved. Now waiting at Review order.",
    })
  })

  test("asks to run the element again for a re-run", async () => {
    const { fixture, panel } = await openPanel("ORD-1001", { writable: true })

    await panel.handle({
      type: "moveToken",
      fromElementId: REVIEW,
      toElementId: REVIEW,
      reason: REASON,
    })

    expect(fixture.effects.confirmWrite).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Run Review order again?", confirmLabel: "Run again" }),
    )
  })

  test("shortens a long reason in the dialog", async () => {
    const { fixture, panel } = await openPanel("ORD-1001", { writable: true })

    await panel.handle({
      type: "moveToken",
      fromElementId: REVIEW,
      toElementId: REVIEW,
      reason: "x".repeat(400),
    })

    const facts = fixture.effects.confirmWrite.mock.calls[0]?.[0].facts ?? []
    expect(facts.find((fact) => fact.startsWith("Reason:"))).toHaveLength(160)
  })

  test("does nothing when the user cancels", async () => {
    let commands: ReturnType<typeof spiedMoves> | undefined
    const { fixture, panel, view } = await openPanel("ORD-1002", {
      writable: true,
      adaptCommands: (given) => (commands = spiedMoves(given)),
    })
    fixture.effects.confirmWrite.mockResolvedValueOnce(false)

    await panel.handle({
      type: "moveToken",
      fromElementId: CHARGE,
      toElementId: REVIEW,
      reason: REASON,
    })

    expect(commands?.moveToken).not.toHaveBeenCalled()
    expect(view().write).toEqual({
      status: "cancelled",
      target: { kind: "token", fromElementId: CHARGE },
    })
  })

  test.each(["", "   ", "two\nlines", "x".repeat(501)])(
    "refuses the reason %j before asking",
    async (reason) => {
      const { fixture, panel, view } = await openPanel("ORD-1002", { writable: true })

      await panel.handle({ type: "moveToken", fromElementId: CHARGE, toElementId: REVIEW, reason })

      expect(fixture.effects.confirmWrite).not.toHaveBeenCalled()
      expect(view().write).toMatchObject({
        status: "failed",
        target: { kind: "token", fromElementId: CHARGE },
      })
    },
  )

  test.each([
    [CHARGE, "Event_PaymentCharged"],
    [CHARGE, "Somewhere_Else"],
    [REVIEW, CHARGE],
  ])(
    "ignores a move from %s to %s that the panel does not offer",
    async (fromElementId, toElementId) => {
      const { fixture, panel } = await openPanel("ORD-1002", { writable: true })

      await panel.handle({ type: "moveToken", fromElementId, toElementId, reason: REASON })

      expect(fixture.effects.confirmWrite).not.toHaveBeenCalled()
    },
  )

  test("says that nothing changed when the engine refuses and shows the instance again", async () => {
    const { fixture, panel, view } = await openPanel("ORD-1002", {
      writable: true,
      adaptCommands: (given) => ({
        ...given,
        moveToken: () =>
          Promise.reject(new RuntimeError("rejected", "No token waits at Activity_ChargePayment.")),
      }),
    })
    const loads = fixture.calls.filter((call) => call === "getInstanceDetail").length

    await panel.handle({
      type: "moveToken",
      fromElementId: CHARGE,
      toElementId: REVIEW,
      reason: REASON,
    })

    expect(view().write).toEqual({
      status: "failed",
      target: { kind: "token", fromElementId: CHARGE },
      message:
        "local refused the change. Nothing was changed. No token waits at Activity_ChargePayment.",
    })
    expect(fixture.calls.filter((call) => call === "getInstanceDetail").length).toBe(loads + 1)
    expect(fixture.effects.reportWritten).not.toHaveBeenCalled()
  })

  test("reports other failures without reloading", async () => {
    const { fixture, panel, view } = await openPanel("ORD-1002", {
      writable: true,
      adaptCommands: (given) => ({
        ...given,
        moveToken: () => Promise.reject(new RuntimeError("unreachable", "Connection refused.")),
      }),
    })
    const loads = fixture.calls.filter((call) => call === "getInstanceDetail").length

    await panel.handle({
      type: "moveToken",
      fromElementId: CHARGE,
      toElementId: REVIEW,
      reason: REASON,
    })

    expect(view().write).toMatchObject({
      status: "failed",
      message: "Can't reach local. Connection refused.",
    })
    expect(fixture.calls.filter((call) => call === "getInstanceDetail").length).toBe(loads)
  })

  test("leaves the outcome to a refresh the user started while the move reloaded", async () => {
    const opened: { panel?: InstancePanel } = {}
    let refreshOnNextLoad = false
    const fixture = panelFixture(
      (runtime) =>
        Object.assign(Object.create(runtime) as typeof runtime, {
          getInstanceDetail: (...args: Parameters<typeof runtime.getInstanceDetail>) => {
            if (refreshOnNextLoad) {
              refreshOnNextLoad = false
              void opened.panel?.handle({ type: "refresh" })
            }
            return runtime.getInstanceDetail(...args)
          },
        }),
      {
        writable: true,
        adaptCommands: (given) => ({
          ...given,
          moveToken: () => {
            refreshOnNextLoad = true
            return Promise.resolve()
          },
        }),
      },
    )
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])
    opened.panel = panel
    await panel.handle({ type: "ready" })

    await panel.handle({
      type: "moveToken",
      fromElementId: CHARGE,
      toElementId: REVIEW,
      reason: REASON,
    })

    expect(readyView(fixture.lastState()).outcome).toBeUndefined()
  })

  test("warns when the token still waits at its source after the move", async () => {
    const { panel, view } = await openPanel("ORD-1002", {
      writable: true,
      adaptCommands: (given) => ({ ...given, moveToken: () => Promise.resolve() }),
    })

    await panel.handle({
      type: "moveToken",
      fromElementId: CHARGE,
      toElementId: REVIEW,
      reason: REASON,
    })

    expect(view().outcome).toMatchObject({
      tone: "warning",
      title: "The engine accepted the move, but a token still waits at Charge payment.",
    })
  })
})
