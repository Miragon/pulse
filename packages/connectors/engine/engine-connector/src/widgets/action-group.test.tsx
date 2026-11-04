// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { cleanup, render, waitFor } from "@testing-library/react"
import type { EngineHealthData, IncidentDetailData, ProcessIncidentsData } from "../view-models.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { EngineHealthView } from "./engine-health.js"
import { IncidentDetailWidget } from "./incident-detail.js"
import { ProcessDetailHeader } from "./process-incidents/header.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"

/** One action group, one size, one order; an operator reported actions in three places and sizes. */

afterEach(() => {
  cleanup()
})

let tools: Record<string, unknown>
beforeAll(async () => {
  tools = { [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("operations") }
})

function head(container: HTMLElement) {
  const header = container.querySelector<HTMLElement>('[data-slot="widget-header"]')!
  const [facts, group] = Array.from(header.children) as HTMLElement[]
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
    // The kit's button size sm: 32 px, 14 px, semibold.
    expect(action.className, nameOf(action)).toMatch(/\bh-8\b/)
    expect(action.className, nameOf(action)).toMatch(/\btext-sm\b/)
    expect(action.className, nameOf(action)).toMatch(/\bfont-semibold\b/)
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
