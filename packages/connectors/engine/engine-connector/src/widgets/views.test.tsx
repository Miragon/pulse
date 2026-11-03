// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { cleanup, render, screen } from "@testing-library/react"
import type { MCPServer } from "mcp-use"
import {
  TestViewHost,
  type HostAction,
  type ViewComponent,
} from "@miragon/pulse-widget-shell/widgets"
import { createPlugin } from "../plugin.js"
import {
  ENGINE_INCIDENTS_DATA,
  ENGINE_OPEN_COCKPIT,
  ENGINE_PROCESS_INCIDENTS_DATA,
} from "../tool-names.js"
import type {
  CockpitAppData,
  CockpitStart,
  IncidentsDashboardData,
  ProcessIncidentsData,
} from "../view-models.js"
import { engineViews } from "./views.js"

afterEach(() => {
  cleanup()
})

/** Every view-bound tool the plugin registers on its widest toolset. */
function viewTools(): string[] {
  const register = vi.fn()
  createPlugin({
    engines: [{ id: "prod-a", baseUrl: "http://prod-a.example/engine-rest" }],
    toolset: "admin",
  }).register({ tool: register, prompt: vi.fn() } as unknown as MCPServer)
  return register.mock.calls
    .map(([definition]) => definition as { name: string; _meta?: { ui?: unknown } })
    .filter((d) => d._meta?.ui !== undefined || /_show_|_open_/.test(d.name))
    .map((d) => d.name)
}

const DEFINITION: ProcessIncidentsData = {
  processDefinitionKey: "leasing",
  processDefinitionName: "Leasing",
  diagramVersion: 2,
  diagramDefinitionId: null,
  cockpitUrl: null,
  runningInstances: 4,
  incidentCount: 0,
  last24hCount: 0,
  failedJobs: 0,
  totalActivityCount: 2,
  affectedDiagramActivityCount: 0,
  latestIncident: null,
  activities: [],
  siblingsWithIncidents: null,
  engineVendor: "CIB seven",
  engineId: "prod-a",
}

/** The one engine view as `engine_open_cockpit` delivers it, opened on its start view. */
function renderCockpit(start: CockpitStart, actions: HostAction[] = []) {
  const cockpit = engineViews[ENGINE_OPEN_COCKPIT] as ViewComponent<CockpitAppData>
  const data: CockpitAppData = {
    engineId: "prod-a",
    engines: [{ id: "prod-a", environment: "default" }],
    start,
  }
  return render(
    <TestViewHost onHostAction={(action) => actions.push(action)}>
      {createElement(cockpit, { data })}
    </TestViewHost>,
  )
}

const feedReads = (actions: HostAction[], feed: string) =>
  actions.filter((a) => a.type === "callTool" && a.name === feed)

describe("engineViews", () => {
  it("holds a view for every view-bound engine tool, and nothing else", () => {
    expect(Object.keys(engineViews).sort()).toEqual(viewTools().sort())
    expect(Object.keys(engineViews)).toEqual([ENGINE_OPEN_COCKPIT])
  })

  it("opens the cockpit on a process focused on incidents, from its seed", async () => {
    const actions: HostAction[] = []
    renderCockpit(
      {
        view: { section: "process-detail", processDefinitionKey: "leasing", focus: "incidents" },
        data: DEFINITION,
      },
      actions,
    )
    expect(await screen.findAllByText("Leasing")).not.toHaveLength(0)
    // The start data seeds the feed: no read until something invalidates it.
    expect(feedReads(actions, ENGINE_PROCESS_INCIDENTS_DATA)).toEqual([])
  })

  it("opens the cockpit on the incidents dashboard: its KPIs over its process list", async () => {
    const actions: HostAction[] = []
    const dashboard: IncidentsDashboardData = {
      totalCount: 0,
      processCount: 0,
      affectedActivityCount: 0,
      last24hCount: 0,
      latestIncident: null,
      processes: [],
      filters: {},
      engineVendor: "CIB seven",
      engineId: "prod-a",
    }
    renderCockpit({ view: { section: "incidents" }, data: dashboard }, actions)
    // The title keeps the engine (#322 U4), in the cockpit as before.
    expect(await screen.findByRole("heading", { name: "prod-a · Incidents" })).toBeTruthy()
    expect(feedReads(actions, ENGINE_INCIDENTS_DATA)).toEqual([])
    expect(actions.filter((a) => a.type === "sendFollowUp")).toEqual([])
  })
})
