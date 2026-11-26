import {
  ElementId,
  IncidentId,
  InstanceId,
  type InstanceDetail,
  type ProcessRuntime,
  type WaitState,
} from "@miragon/pulse-engine-core"
import { PatchedRuntime } from "@miragon/pulse-engine-core/testing"
import { afterEach, describe, expect, it, vi } from "vitest"
import { InstancePanel } from "../../src/core/panels/instance-panel.js"
import type { PanelState } from "../../src/core/protocol/index.js"
import { panelFixture } from "../core/support/panel-fixture.js"
import { INSTANCE_WORDING } from "./instance-wording.expected.js"
import {
  allParts,
  allRoles,
  findPart,
  findRole,
  getRole,
  mountApp,
  nextFrame,
  part,
  queryPart,
  waitForElement,
  type Harness,
} from "./harness.js"

const CLOCK = /(?:[A-Z][a-z]{2} \d{1,2}, )?\d{1,2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:\s?[AP]M)?/g
const RELATIVE = /\d+\s?[a-z]+\.?\s+ago|in \d+\s?[a-z]+\.?|just now|in under a minute/g

function timeless(text: string | null | undefined): string | null {
  return text === null || text === undefined
    ? null
    : text.replace(CLOCK, "<clock>").replace(RELATIVE, "<relative>")
}

function controlsOf(root: Element): (string | null)[][] {
  return [...root.querySelectorAll("button")].map((button) => [
    button.getAttribute("aria-label") ?? timeless(button.textContent),
    timeless(button.getAttribute("title")),
    button.getAttribute("data-part"),
  ])
}

function factsOf(root: Element): (string | null)[] {
  return [...root.querySelectorAll("dt")].map(
    (term) => `${term.textContent}: ${timeless(term.nextElementSibling?.textContent) ?? ""}`,
  )
}

async function tabNamed(harness: Harness, name: string): Promise<HTMLElement> {
  getRole(harness.root, "tab", { name: new RegExp(`^${name}`) }).click()
  return findRole(harness.root, "tabpanel", { name: new RegExp(`^${name}`) })
}

async function tableWording(harness: Harness, tab: string) {
  const panel = await tabNamed(harness, tab)
  const table = panel.querySelector("table")
  if (table === null) {
    return { empty: queryPart(panel, "empty-hint")?.textContent ?? null }
  }
  return {
    table: table.getAttribute("aria-label"),
    heads: [...table.querySelectorAll("th")].map((head) => head.textContent),
    rows: [...table.querySelectorAll("tbody tr")].map((row) => [
      ...[...row.querySelectorAll("td")].map((cell) => timeless(cell.textContent)),
      ...controlsOf(row).flat(),
    ]),
    empty: queryPart(panel, "empty-hint")?.textContent ?? null,
  }
}

async function incidentWording(harness: Harness) {
  const panel = await tabNamed(harness, "Incidents")
  const cards = allParts(panel, "incident-card")
  return {
    cards: cards.map((card) => ({
      label: card.getAttribute("aria-label"),
      head: timeless(card.querySelector("header")?.textContent),
      facts: factsOf(card),
      controls: controlsOf(card),
    })),
    empty: queryPart(panel, "empty-hint")?.textContent ?? null,
  }
}

async function wordingOf(harness: Harness, state: PanelState) {
  harness.publish(state)
  const bar = await findPart(harness.root, "context-bar")
  await vi.waitFor(() => {
    expect(getRole(harness.root, "tablist")).toBeDefined()
  })
  await waitForElement(harness.root, "g.djs-element")
  await nextFrame()
  const facts = bar.querySelector('[data-slot="view-bar-facts"]')
  const legend = getRole<HTMLButtonElement>(
    harness.root.querySelector(part("tab-bar")) ?? harness.root,
    "button",
    { name: "Legend" },
  )
  return {
    heading: getRole(bar, "heading", { level: 1 }).textContent,
    facts: facts === null ? null : timeless(facts.textContent),
    factControls: facts === null ? [] : controlsOf(facts),
    strips: timeless(queryPart(harness.root, "strips")?.textContent),
    tabs: allRoles(getRole(harness.root, "tablist"), "tab").map((tab) => tab.textContent),
    legend: (legend.popoverTargetElement as HTMLElement).textContent,
    incidents: await incidentWording(harness),
    waiting: await tableWording(harness, "Waiting"),
    history: await tableWording(harness, "History"),
    variables: await tableWording(harness, "Variables"),
  }
}

type Adapt = (runtime: ProcessRuntime) => ProcessRuntime

function patchedDetail(change: (detail: InstanceDetail) => InstanceDetail): Adapt {
  return (runtime) =>
    new PatchedRuntime(runtime, {
      getInstanceDetail: async (instanceId) => {
        const detail = await runtime.getInstanceDetail(instanceId)
        return detail && change(detail)
      },
    })
}

async function stateOf(
  alias: "ORD-1001" | "ORD-1002" | "ORD-1003" | "DSP-3001" | "label",
  options: { readonly writable?: boolean; readonly adapt?: Adapt } = {},
): Promise<PanelState> {
  const fixture = panelFixture(options.adapt, {
    ...(options.writable === undefined ? {} : { writable: options.writable }),
  })
  const instanceId =
    alias === "label" ? InstanceId("fake-label-of-DSP-3001") : fixture.world.instanceIds[alias]
  const panel = new InstancePanel(fixture.context, instanceId)
  await panel.handle({ type: "ready" })
  return fixture.lastState()
}

const EVERY_WAIT = (detail: InstanceDetail): InstanceDetail => {
  const [first] = detail.waitStates
  if (first === undefined) {
    throw new Error("the instance waits nowhere")
  }
  const at = (elementId: string) => ({
    instanceId: first.instanceId,
    elementId: ElementId(elementId),
    ...(first.since === undefined ? {} : { since: first.since }),
  })
  const waits: WaitState[] = [
    { ...at("Task_Assigned"), kind: "userTask", assignee: "mia" },
    { ...at("Task_Free"), kind: "userTask" },
    { ...at("Task_Worker"), kind: "workerTask", taskType: "ship-parcel", retriesLeft: 3 },
    { ...at("Task_Async"), kind: "asyncContinuation", retriesLeft: 0 },
    { ...at("Task_AsyncUnknown"), kind: "asyncContinuation" },
    { ...at("Timer_Due"), kind: "timer" },
    { ...at("Message_Paid"), kind: "message", messageName: "PaymentReceived" },
    { ...at("Signal_Stop"), kind: "signal", signalName: "Stop" },
    { ...at("Other_Wait"), kind: "other", description: "Waiting for a condition" },
  ]
  return { ...detail, waitStates: waits }
}

const TWO_INCIDENTS_SUSPENDED = (detail: InstanceDetail): InstanceDetail => {
  const [incident] = detail.incidents
  if (incident === undefined) {
    throw new Error("the instance has no incident")
  }
  return {
    ...detail,
    instance: { ...detail.instance, state: "suspended" },
    incidents: [
      incident,
      { ...incident, id: IncidentId("second-incident"), message: "Second failure" },
    ],
  }
}

const SUSPENDED = (detail: InstanceDetail): InstanceDetail => ({
  ...detail,
  instance: { ...detail.instance, state: "suspended" },
})

describe("the instance view's English words", () => {
  let harness: Harness

  afterEach(() => {
    harness.unmount()
  })

  it.each([
    [
      "a waiting instance the engine lets Pulse write",
      "ordReviewWritable",
      "ORD-1001",
      { writable: true },
    ],
    ["an incident Pulse can retry", "ordIncidentWritable", "ORD-1002", { writable: true }],
    ["an incident on a read-only engine", "ordIncident", "ORD-1002", {}],
    ["an ended instance", "ordEnded", "ORD-1003", {}],
    ["an incident in a called instance", "dispatch", "DSP-3001", {}],
    ["a called instance", "label", "label", {}],
    ["every kind of wait", "everyWait", "ORD-1001", { adapt: patchedDetail(EVERY_WAIT) }],
    [
      "two incidents of a suspended instance",
      "twoIncidentsSuspended",
      "ORD-1002",
      { adapt: patchedDetail(TWO_INCIDENTS_SUSPENDED) },
    ],
    [
      "one incident of a suspended instance",
      "suspended",
      "ORD-1002",
      { adapt: patchedDetail(SUSPENDED) },
    ],
  ] as const)("name %s as before", async (_case, expected, alias, options) => {
    harness = mountApp()

    expect(await wordingOf(harness, await stateOf(alias, options))).toEqual(
      INSTANCE_WORDING[expected],
    )
  })
})
