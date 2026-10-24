import { PatchedRuntime } from "../../src/contract/fake/index.js"
import { RuntimeError, type ProcessCommands } from "../../src/contract/index.js"
import { describe, expect, test, vi } from "vitest"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import type { InstanceView, PanelState } from "../../src/core/protocol/index.js"
import { panelFixture, type FixtureOptions } from "./support/panel-fixture.js"

const CHARGE = "Activity_ChargePayment"

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

function spied(commands: ProcessCommands) {
  return {
    retryIncident: vi.fn((incidentId: Parameters<ProcessCommands["retryIncident"]>[0]) =>
      commands.retryIncident(incidentId),
    ),
    setVariable: vi.fn((...args: Parameters<ProcessCommands["setVariable"]>) =>
      commands.setVariable(...args),
    ),
    moveToken: vi.fn((...args: Parameters<ProcessCommands["moveToken"]>) =>
      commands.moveToken(...args),
    ),
    cancelInstances: (...args: Parameters<ProcessCommands["cancelInstances"]>) =>
      commands.cancelInstances(...args),
    migrateInstances: (...args: Parameters<ProcessCommands["migrateInstances"]>) =>
      commands.migrateInstances(...args),
    stopBulkOperation: (...args: Parameters<ProcessCommands["stopBulkOperation"]>) =>
      commands.stopBulkOperation(...args),
  }
}

describe("an instance on a read-only engine", () => {
  test("offers neither retry nor editing and ignores write intents", async () => {
    const { fixture, panel, view } = await openPanel("ORD-1002", {})

    expect(view().incidents[0]?.retryable).toBeUndefined()
    expect(view().variables.every((row) => row.editor === undefined)).toBe(true)

    await panel.handle({ type: "retryIncident", incidentId: view().incidents[0]!.id })
    await panel.handle({ type: "setVariable", name: "amount", valueJson: "1" })

    expect(fixture.effects.confirmWrite).not.toHaveBeenCalled()
  })
})

describe("retrying an incident", () => {
  test("confirms the exact target, runs the retry and checks again", async () => {
    let commands: ReturnType<typeof spied> | undefined
    const { fixture, panel, view } = await openPanel("ORD-1002", {
      writable: true,
      adaptCommands: (given) => (commands = spied(given)),
    })
    const incident = view().incidents[0]!
    expect(incident.retryable).toBe(true)
    expect(view().headline).toBeUndefined()

    await panel.handle({ type: "retryIncident", incidentId: incident.id })

    expect(fixture.effects.confirmWrite).toHaveBeenCalledWith({
      action: "retryIncident",
      title: `Retry the incident at ${CHARGE}?`,
      facts: [
        "Instance ORD-1002 (fake-ORD-1002) · Order fulfillment v1",
        "Failed task: MissingBean: Cannot resolve identifier",
        "Retries 0 → 1",
        "Data read just now",
      ],
      confirmLabel: "Retry",
    })
    expect(commands?.retryIncident).toHaveBeenCalledWith(incident.id)
    expect(fixture.effects.reportWritten).toHaveBeenCalledWith(
      `Retried the incident at ${CHARGE} on local (localhost).`,
    )
    const published = fixture.states.flatMap((state) =>
      state.status === "ready" && state.view.kind === "instance" ? [state.view] : [],
    )
    expect(published.map((shown) => shown.write?.status)).toContain("pending")
    expect(view().incidents).toEqual([])
    expect(view().write).toEqual({
      status: "done",
      target: { kind: "incident", incidentId: incident.id },
    })
    expect(view().outcome).toMatchObject({
      tone: "info",
      title: `Waiting at ${CHARGE} for the next attempt.`,
    })
  })

  test("checks again for a minute until the instance settles", async () => {
    const { fixture, panel, view } = await openPanel("ORD-1002", { writable: true })

    await panel.handle({ type: "retryIncident", incidentId: view().incidents[0]!.id })

    const delays = vi.mocked(fixture.context.wait).mock.calls.map(([delay]) => delay)
    expect(delays.reduce((sum, delay) => sum + delay, 0)).toBe(60_000)
  })

  test("stops checking when the user refreshes", async () => {
    const { fixture, panel, view } = await openPanel("ORD-1002", { writable: true })
    let refreshed = false
    vi.mocked(fixture.context.wait).mockImplementation(async () => {
      if (!refreshed) {
        refreshed = true
        await panel.handle({ type: "refresh" })
      }
    })

    await panel.handle({ type: "retryIncident", incidentId: view().incidents[0]!.id })

    expect(fixture.context.wait).toHaveBeenCalledTimes(1)
    expect(view().outcome).toBeUndefined()
  })

  test("stops checking once the instance moved on", async () => {
    let retried = false
    const fixture = panelFixture(
      (runtime) =>
        new PatchedRuntime(runtime, {
          getInstanceDetail: async (instanceId) => {
            const detail = await runtime.getInstanceDetail(instanceId)
            return detail && retried ? { ...detail, waitStates: [] } : detail
          },
        }),
      {
        writable: true,
        adaptCommands: (given) => ({
          ...given,
          retryIncident: async (incidentId) => {
            await given.retryIncident(incidentId)
            retried = true
          },
        }),
      },
    )
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["ORD-1002"])
    await panel.handle({ type: "ready" })
    const incidentId = readyView(fixture.lastState()).incidents[0]!.id

    await panel.handle({ type: "retryIncident", incidentId })

    expect(fixture.context.wait).toHaveBeenCalledTimes(1)
    expect(readyView(fixture.lastState()).outcome?.title).toBe(`Moved on from ${CHARGE}.`)
  })

  test("does nothing when the user cancels", async () => {
    let commands: ReturnType<typeof spied> | undefined
    const { fixture, panel, view } = await openPanel("ORD-1002", {
      writable: true,
      adaptCommands: (given) => (commands = spied(given)),
    })
    fixture.effects.confirmWrite.mockResolvedValueOnce(false)

    await panel.handle({ type: "retryIncident", incidentId: view().incidents[0]!.id })

    expect(commands?.retryIncident).not.toHaveBeenCalled()
    expect(view().write).toEqual({
      status: "cancelled",
      target: { kind: "incident", incidentId: view().incidents[0]!.id },
    })
    expect(view().incidents).toHaveLength(1)
  })

  test("ignores an incident the panel does not show", async () => {
    const { fixture, panel } = await openPanel("ORD-1002", { writable: true })

    await panel.handle({ type: "retryIncident", incidentId: "incident-of-somebody-else" })

    expect(fixture.effects.confirmWrite).not.toHaveBeenCalled()
  })

  test("runs one write at a time", async () => {
    const { fixture, panel, view } = await openPanel("ORD-1002", { writable: true })
    let answer: (confirmed: boolean) => void = () => undefined
    fixture.effects.confirmWrite.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          answer = resolve
        }),
    )
    const incidentId = view().incidents[0]!.id

    const first = panel.handle({ type: "retryIncident", incidentId })
    await panel.handle({ type: "retryIncident", incidentId })
    answer(false)
    await first

    expect(fixture.effects.confirmWrite).toHaveBeenCalledTimes(1)
  })

  test("shows why the engine refused and keeps the incident", async () => {
    const { fixture, panel, view } = await openPanel("ORD-1002", {
      writable: true,
      adaptCommands: (given) => ({
        ...given,
        retryIncident: () =>
          Promise.reject(new RuntimeError("rejected", "Incident is not open anymore.")),
      }),
    })
    const incidentId = view().incidents[0]!.id

    await panel.handle({ type: "retryIncident", incidentId })

    expect(fixture.effects.reportProblem).toHaveBeenCalledWith(
      expect.objectContaining({ title: "local refused the change." }),
    )
    expect(view().write).toEqual({
      status: "failed",
      target: { kind: "incident", incidentId },
      message: "local refused the change. Incident is not open anymore.",
    })
    expect(fixture.effects.reportWritten).not.toHaveBeenCalled()
  })

  test("forgets the outcome on refresh", async () => {
    const { panel, view } = await openPanel("ORD-1002", { writable: true })
    await panel.handle({ type: "retryIncident", incidentId: view().incidents[0]!.id })
    expect(view().outcome).toBeDefined()

    await panel.handle({ type: "refresh" })

    expect(view().outcome).toBeUndefined()
    expect(view().write).toBeUndefined()
  })
})

describe("changing a variable", () => {
  test("keeps the type and confirms old and new value", async () => {
    let commands: ReturnType<typeof spied> | undefined
    const { fixture, panel, view } = await openPanel("ORD-1002", {
      writable: true,
      adaptCommands: (given) => (commands = spied(given)),
    })
    expect(view().variables.find((row) => row.name === "amount")?.editor).toBe("integer")

    await panel.handle({ type: "setVariable", name: "amount", valueJson: " 43 " })

    expect(fixture.effects.confirmWrite).toHaveBeenCalledWith({
      action: "setVariable",
      title: "Change amount?",
      facts: [
        "Instance ORD-1002 (fake-ORD-1002) · Order fulfillment v1",
        "Integer: 42 → 43",
        "Data read just now",
      ],
      confirmLabel: "Change",
    })
    expect(commands?.setVariable).toHaveBeenCalledWith(fixture.world.instanceIds["ORD-1002"], {
      name: "amount",
      valueJson: "43",
      type: "Integer",
    })
    expect(fixture.effects.reportWritten).toHaveBeenCalledWith(
      "Changed amount on local (localhost).",
    )
    expect(view().variables.find((row) => row.name === "amount")?.valueJson).toBe("43")
    expect(view().outcome).toEqual({
      tone: "info",
      title: "Changed amount.",
      actions: [{ kind: "retryIncident", label: "Retry now", incidentId: view().incidents[0]!.id }],
    })
  })

  test("offers Retry now when the incident sits in a called instance", async () => {
    const fixture = panelFixture((runtime) => runtime, { writable: true })
    const panel = new InstancePanel(fixture.context, fixture.world.instanceIds["DSP-3001"])
    await panel.handle({ type: "ready" })

    await panel.handle({ type: "setVariable", name: "orderId", valueJson: '"ORD-1009"' })

    const view = readyView(fixture.lastState())
    expect(view.outcome?.actions).toEqual([
      { kind: "retryIncident", label: "Retry now", incidentId: view.incidents[0]!.id },
    ])
  })

  test("refuses a value that does not fit the type before asking", async () => {
    const { fixture, panel, view } = await openPanel("ORD-1002", { writable: true })

    await panel.handle({ type: "setVariable", name: "amount", valueJson: "4.5" })

    expect(fixture.effects.confirmWrite).not.toHaveBeenCalled()
    expect(view().write).toEqual({
      status: "failed",
      target: { kind: "variable", name: "amount" },
      message: "amount takes a whole number (Integer).",
    })
  })

  test("accepts null on purpose", async () => {
    const { fixture, panel } = await openPanel("ORD-1002", { writable: true })

    await panel.handle({ type: "setVariable", name: "route", valueJson: "null" })

    expect(fixture.effects.confirmWrite).toHaveBeenCalled()
  })

  test("ignores element-local, unknown and ended-instance variables", async () => {
    const running = await openPanel("ORD-1001", { writable: true })
    expect(running.view().variables.find((row) => row.name === "reviewNote")?.editor).toBe(
      undefined,
    )
    await running.panel.handle({ type: "setVariable", name: "reviewNote", valueJson: '"x"' })
    await running.panel.handle({ type: "setVariable", name: "missing", valueJson: '"x"' })
    expect(running.fixture.effects.confirmWrite).not.toHaveBeenCalled()

    const ended = await openPanel("ORD-1003", { writable: true })
    expect(ended.view().variables.every((row) => row.editor === undefined)).toBe(true)
  })
})
