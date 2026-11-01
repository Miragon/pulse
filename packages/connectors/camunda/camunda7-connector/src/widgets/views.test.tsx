// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { MCPServer } from "mcp-use"
import {
  TestViewHost,
  type HostAction,
  type ViewComponent,
} from "@miragon/pulse-widget-shell/widgets"
import { createPlugin } from "../plugin.js"
import {
  CAMUNDA7_OPEN_COCKPIT,
  CAMUNDA7_PROCESS_INCIDENTS_DATA,
  CAMUNDA7_SHOW_INCIDENTS_DASHBOARD,
  CAMUNDA7_SHOW_PROCESS_INCIDENTS,
  CAMUNDA7_SHOW_SETTINGS,
} from "../tool-names.js"
import type { IncidentsDashboardData, ProcessIncidentsData } from "../view-models.js"
import { camunda7HostWidgets, camunda7Views } from "./views.js"

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

function renderView(name: string, data: unknown, actions: HostAction[] = []) {
  const view = camunda7Views[name] as ViewComponent<unknown>
  return render(
    <TestViewHost onHostAction={(action) => actions.push(action)}>
      {createElement(view, { data })}
    </TestViewHost>,
  )
}

describe("camunda7Views", () => {
  it("holds a view for every view-bound camunda7 tool, and nothing else", () => {
    expect(Object.keys(camunda7Views).sort()).toEqual(viewTools().sort())
    expect(Object.keys(camunda7Views)).toContain(CAMUNDA7_OPEN_COCKPIT)
  })

  it("renders the process incidents view on its data, focused on incidents", async () => {
    const actions: HostAction[] = []
    renderView(CAMUNDA7_SHOW_PROCESS_INCIDENTS, DEFINITION, actions)
    expect(await screen.findAllByText("Leasing")).not.toHaveLength(0)
    // The data seeds the feed: no read until something invalidates it.
    expect(
      actions.some((a) => a.type === "callTool" && a.name === CAMUNDA7_PROCESS_INCIDENTS_DATA),
    ).toBe(false)
  })

  it("renders the incidents dashboard: its KPIs over its process list", async () => {
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
    renderView(CAMUNDA7_SHOW_INCIDENTS_DASHBOARD, dashboard, actions)
    expect(await screen.findByRole("heading", { name: "prod-a · Incidents" })).toBeTruthy()
    expect(actions.filter((a) => a.type === "sendFollowUp")).toEqual([])
  })

  it("renders the settings view from its data", async () => {
    renderView(CAMUNDA7_SHOW_SETTINGS, {
      profile: {
        updatedAt: "2026-10-01T00:00:00.000Z",
        defaultEngineId: "prod-a",
        allowedEngineIds: [],
      },
      availableEngines: [{ id: "prod-a", environment: "default" }],
      canSave: false,
      readOnlyReason: "toolset",
    })
    expect(await screen.findByText("prod-a")).toBeTruthy()
  })
})

describe("camunda7HostWidgets", () => {
  it("offers the settings section under the page's `<module>:settings` id", () => {
    expect(Object.keys(camunda7HostWidgets)).toEqual(["camunda7:settings"])
  })

  it("renders the section self-fetching", async () => {
    const actions: HostAction[] = []
    render(
      <TestViewHost onHostAction={(action) => actions.push(action)}>
        {createElement(camunda7HostWidgets["camunda7:settings"])}
      </TestViewHost>,
    )
    await waitFor(() =>
      expect(actions).toContainEqual({
        type: "callTool",
        name: "camunda7_settings_data",
        args: {},
      }),
    )
  })
})
