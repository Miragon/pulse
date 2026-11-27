// @vitest-environment happy-dom
import type { ReactElement } from "react"
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { cleanup, render, waitFor } from "@testing-library/react"
import type { EngineHealthData, IncidentDetailData, ProcessIncidentsData } from "../view-models.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { EngineHealthView } from "./engine-health.js"
import { IncidentDetailWidget } from "./incident-detail.js"
import { InstanceDetailWidget } from "./instance-detail.js"
import { ProcessDetailHeader } from "./process-incidents/header.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"
import { instance } from "./write-path.test-support.js"
import {
  createTestQueryClient,
  TestViewHost,
  type FollowUp,
} from "@miragon/pulse-widget-shell/widgets"
import { buttonVariants } from "@miragon/pulse-ui"

/**
 * One action group, one size, one order; an operator reported actions in three places and sizes.
 * In the view's bar every action is the kit's toolbar button (the webview's header buttons): the
 * icon and the label at 400, 28 px, the label hidden visually in a bar under 36rem.
 */

afterEach(() => {
  cleanup()
})

let tools: Record<string, unknown>
beforeAll(async () => {
  tools = { [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("operations") }
})

/** The view's bar (WidgetHeader renders the kit's ViewBar): its facts and its one action group. */
function head(container: HTMLElement) {
  const bar = container.querySelector<HTMLElement>('[data-slot="view-bar"]')!
  // A bar whose facts would only repeat its tiles has none (the overview's).
  const facts = bar.querySelector<HTMLElement>('[data-slot="view-bar-facts"]')
  const group = bar.querySelector<HTMLElement>('[data-slot="view-bar-actions"]')
  const actions = Array.from(group?.querySelectorAll<HTMLElement>("a, button") ?? [])
  return { facts, actions }
}

const nameOf = (el: HTMLElement) =>
  el.getAttribute("aria-label") ?? el.getAttribute("title") ?? (el.textContent ?? "").trim()

async function expectOneGroup(container: HTMLElement, names: RegExp[]) {
  // A write action shows once the widget-actions feed answered; a hand-off renders at once.
  await waitFor(() => expect(head(container).actions).toHaveLength(names.length))
  const { facts, actions } = head(container)
  // Facts only: no link and no action in the meta line.
  expect(facts?.querySelectorAll("a") ?? []).toHaveLength(0)
  expect(actions.map(nameOf)).toEqual(names.map((name) => expect.stringMatching(name) as string))
  for (const action of actions) {
    const name = nameOf(action)
    // The kit's toolbar button, size sm: the density's control (28 px, 36 px on touch), 13 px at
    // 400, the classes of `buttonVariants({ variant: "toolbar", size: "sm" })`.
    expect(action.className, name).toBe(buttonVariants({ variant: "toolbar", size: "sm" }))
    expect(action.className, name).toMatch(/(^| )min-h-control( |$)/)
    expect(action.className, name).toMatch(/(^| )text-dense( |$)/)
    expect(action.className, name).toMatch(/(^| )font-normal( |$)/)
    // An icon first, then the label the bar may hide visually: the name stays the label's.
    expect(action.firstElementChild?.tagName.toLowerCase(), name).toBe("svg")
    const label = action.querySelector('[data-slot="button-label"]')
    expect(label?.textContent, name).toBeTruthy()
    expect(name).toContain(label?.textContent ?? "")
  }
}

const DEFINITION: ProcessIncidentsData = {
  processDefinitionKey: "leasing",
  processDefinitionName: "Leasing",
  diagramVersion: 2,
  diagramDefinitionId: null,
  cockpitUrl: "https://engine.example/cockpit/leasing",
  runningInstances: 99,
  incidentCount: 3,
  failedJobs: 2,
  totalActivityCount: 2,
  affectedDiagramActivityCount: 1,
  latestIncident: "2026-10-10T12:00:00.000+0000",
  activities: [],
  siblingsWithIncidents: null,
  engineVendor: "CIB seven",
  engineId: "prod-a",
}

const INCIDENT: IncidentDetailData = {
  incidentId: "inc-1",
  incidentType: "failedJob",
  incidentMessage: "boom",
  incidentTimestamp: "2026-10-09T09:30:00.000+0000",
  activityId: "charge",
  activityName: "Charge card",
  processDefinitionKey: "invoice",
  processDefinitionId: "invoice:1:abc",
  processDefinitionName: "Invoice",
  processDefinitionVersion: 1,
  processInstanceId: "pi-1",
  businessKey: null,
  cockpitInstanceUrl: "https://engine.example/cockpit/pi-1",
  engineVendor: "CIB seven",
  diagramDefinitionId: null,
  job: null,
  externalTask: null,
  recovery: { action: "resolve" },
  instance: {
    id: "pi-1",
    definitionId: "invoice:1:abc",
    businessKey: null,
    suspended: false,
    ended: false,
  },
  activityTree: null,
  variables: {},
  rootCause: null,
  engineId: "prod",
}

/** A delegated incident's root cause: the failure in a called instance. */
const ROOT_CAUSE: NonNullable<IncidentDetailData["rootCause"]> = {
  incidentId: "inc-root",
  message: "boom",
  activityId: "checkBlacklist",
  activityName: "Check blacklist",
  processInstanceId: "called-1",
  processName: "Assess customer",
}

const HEALTH: EngineHealthData = {
  status: "warning",
  statusRule: "warning with any open incident",
  summary: {
    totalIncidents: 3,
    outsideAnyProcess: { count: 0, atLeast: false },
    lastHourIncidents: 1,
    affectedActivities: 1,
    affectedDefinitions: 1,
    runningInstances: 12,
    totalDefinitions: 2,
    started24h: 10,
    completed24h: 8,
    historyRecorded: true,
  },
  clusters: [],
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: "prod",
}

/** No open incident: nothing to look at first. */
const QUIET: EngineHealthData = {
  ...HEALTH,
  status: "ok",
  summary: { ...HEALTH.summary, totalIncidents: 0, lastHourIncidents: 0 },
}

const definitionView = () => (
  <ProcessDetailHeader data={DEFINITION} processDefinitionKey="leasing" engine="prod-a" />
)
const incidentView = (data = INCIDENT) => (
  <IncidentDetailWidget data={data} incidentId="inc-1" engine="prod" />
)
const instanceView = (data = instance()) => (
  <InstanceDetailWidget data={data} processInstanceId="pi-1" engine="prod" />
)
const healthView = (data = HEALTH) => <EngineHealthView data={data} engine="prod" />

describe("one action group per view, one action size", () => {
  it("definition view: running instances, the engine's web app, then the chat", async () => {
    const { container } = render(<TestViewHost tools={tools}>{definitionView()}</TestViewHost>)
    await expectOneGroup(container, [/^View running instances$/, /^Open in CIB seven/, /chat/i])
  })

  it("incident detail: its instance, the instance in the engine's web app, then the chat", async () => {
    const { container } = render(<TestViewHost tools={tools}>{incidentView()}</TestViewHost>)
    await expectOneGroup(container, [/^Open instance$/, /^Open instance in CIB seven/, /chat/i])
  })

  it("a delegated incident: its instance, its root cause, the engine's web app, then the chat", async () => {
    const { container } = render(
      <TestViewHost tools={tools}>
        {incidentView({ ...INCIDENT, rootCause: ROOT_CAUSE })}
      </TestViewHost>,
    )
    await expectOneGroup(container, [
      /^Open instance$/,
      /^Open cause$/,
      /^Open instance in CIB seven/,
      /chat/i,
    ])
  })

  // Suspend and Cancel are admin writes; the operations toolset offers neither.
  it("instance detail: its process, then the chat", async () => {
    const { container } = render(<TestViewHost tools={tools}>{instanceView()}</TestViewHost>)
    await expectOneGroup(container, [/^View process$/, /chat/i])
  })

  it("a called instance: its caller, its process, then the chat", async () => {
    const { container } = render(
      <TestViewHost tools={tools}>
        {instanceView(instance({ callerInstanceId: "30654aea-1111-2222-3333-444455556666" }))}
      </TestViewHost>,
    )
    await expectOneGroup(container, [/^Open caller 30654aea…$/, /^View process$/, /chat/i])
  })

  // The cockpit's head holds the one Refresh (#322 U27), so the overview has none of its own.
  it("engine status: the incidents, then the chat", async () => {
    const { container } = render(<TestViewHost tools={tools}>{healthView()}</TestViewHost>)
    await expectOneGroup(container, [/^View incidents$/, /chat/i])
  })
})

/**
 * A page that hides hand-offs (`followUp` "none") keeps a bar's other actions in one group, and a
 * bar left with nothing draws no group at all: no empty space where the chat's action stood.
 */
describe("a page that hides hand-offs keeps a bar's other actions, or draws no group", () => {
  /**
   * Renders under the page's follow-up and waits for the gate feed where the view reads it (a view
   * that writes), so an absent write is a decision.
   */
  async function onPage(view: ReactElement, followUp: FollowUp = "none") {
    const client = createTestQueryClient()
    const { container } = render(
      <TestViewHost tools={tools} client={client} followUp={followUp}>
        {view}
      </TestViewHost>,
    )
    await waitFor(() => {
      const gate = client
        .getQueryCache()
        .find({ queryKey: ["engine-widget-actions"], exact: false })
      expect(gate?.state.status ?? "unread").toMatch(/^(success|unread)$/)
    })
    return container
  }

  const noGroup = (container: HTMLElement) =>
    expect(container.querySelector('[data-slot="view-bar-actions"]')).toBeNull()

  it.each([
    ["definition view", definitionView, [/^View running instances$/, /^Open in CIB seven/]],
    ["incident detail", () => incidentView(), [/^Open instance$/, /^Open instance in CIB seven/]],
    ["instance detail", () => instanceView(), [/^View process$/]],
    ["engine status", () => healthView(), [/^View incidents$/]],
  ] as const)("%s: its deterministic actions alone", async (_, view, names) => {
    await expectOneGroup(await onPage(view()), [...names])
  })

  it("incident detail without a link to the engine's web app: its instance alone", async () => {
    await expectOneGroup(await onPage(incidentView({ ...INCIDENT, cockpitInstanceUrl: null })), [
      /^Open instance$/,
    ])
  })

  it("instance detail whose process it cannot name: no group", async () => {
    noGroup(await onPage(instanceView(instance({ definitionKey: null }))))
  })

  it("engine status without an open incident: no group", async () => {
    noGroup(await onPage(healthView(QUIET)))
  })

  it("a page that copies hand-offs keeps each one, its prompt to copy", async () => {
    await expectOneGroup(await onPage(healthView(QUIET), "copy"), [/^Copy prompt: Assess in chat$/])
  })
})
