// @vitest-environment happy-dom
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
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
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
  const facts = bar.querySelector<HTMLElement>('[data-slot="view-bar-facts"]')!
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
  expect(facts.querySelectorAll("a")).toHaveLength(0)
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

describe("one action group per view, one action size", () => {
  it("definition view: running instances, the engine's web app, then the chat", async () => {
    const data: ProcessIncidentsData = {
      processDefinitionKey: "leasing",
      processDefinitionName: "Leasing",
      diagramVersion: 2,
      diagramDefinitionId: null,
      cockpitUrl: "https://engine.example/cockpit/leasing",
      runningInstances: 99,
      incidentCount: 3,
      last24hCount: 1,
      failedJobs: 2,
      totalActivityCount: 2,
      affectedDiagramActivityCount: 1,
      latestIncident: "2026-10-10T12:00:00.000+0000",
      activities: [],
      siblingsWithIncidents: null,
      engineVendor: "CIB seven",
      engineId: "prod-a",
    }
    const { container } = render(
      <TestViewHost tools={tools}>
        <ProcessDetailHeader data={data as never} processDefinitionKey="leasing" engine="prod-a" />
      </TestViewHost>,
    )
    await expectOneGroup(container, [/^View running instances$/, /^Open in CIB seven/, /chat/i])
  })

  it("incident detail: the instance in the engine's web app, then the chat", async () => {
    const data: IncidentDetailData = {
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
      historyTotalCount: null,
      engineId: "prod",
    }
    const { container } = render(
      <TestViewHost tools={tools}>
        <IncidentDetailWidget data={data as never} incidentId="inc-1" engine="prod" />
      </TestViewHost>,
    )
    await expectOneGroup(container, [/^Open instance in CIB seven/, /chat/i])
  })

  // Suspend and Cancel are admin writes; the operations toolset offers neither.
  it("instance detail: its process, then the chat", async () => {
    const { container } = render(
      <TestViewHost tools={tools}>
        <InstanceDetailWidget data={instance()} processInstanceId="pi-1" engine="prod" />
      </TestViewHost>,
    )
    await expectOneGroup(container, [/^View process$/, /chat/i])
  })

  // The cockpit's head holds the one Refresh (#322 U27), so the overview has none of its own.
  it("engine status: the incidents, then the chat", async () => {
    const data: EngineHealthData = {
      status: "warning",
      statusRule: "warning with any open incident",
      summary: {
        totalIncidents: 3,
        lastHourIncidents: 1,
        last24hIncidents: 2,
        affectedActivities: 1,
        affectedDefinitions: 1,
        runningInstances: 12,
        totalDefinitions: 2,
        started24h: 10,
        completed24h: 8,
      },
      clusters: [],
      fetchedAt: "2026-06-11T14:05:00.000Z",
      engineId: "prod",
    }
    const { container } = render(
      <TestViewHost tools={tools}>
        <EngineHealthView data={data as never} engine="prod" />
      </TestViewHost>,
    )
    await expectOneGroup(container, [/^View incidents$/, /chat/i])
  })
})
