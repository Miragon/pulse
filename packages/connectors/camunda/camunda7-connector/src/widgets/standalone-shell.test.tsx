// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost, type HostActionLog } from "@miragon/mcp-toolkit-ui/app"
import {
  DisplayModeControlProvider,
  HostWidgetsProvider,
  SettingsPageWidget,
  SHELL_SETTINGS_PAGE_WIDGET,
} from "@miragon/pulse-widget-shell/widgets"
import { useNav } from "./navigation.js"
import { Camunda7StandaloneShell, findStepEngineId } from "./standalone-shell.js"

afterEach(() => {
  cleanup()
  // Singleton client: one test's engines result must not leak into the next.
  queryClient.clear()
})

function DrillProbe() {
  const go = useNav()
  return (
    <div>
      <div>origin-content</div>
      <button type="button" onClick={() => go({ type: "settings" })}>
        drill-settings
      </button>
      <button
        type="button"
        onClick={() => go({ type: "process-instances", processDefinitionKey: "invoice" })}
      >
        drill-instances
      </button>
    </div>
  )
}

const Harness: ComponentType<Record<string, unknown>> = () => (
  <Camunda7StandaloneShell>
    <DrillProbe />
  </Camunda7StandaloneShell>
)

const ForeignSection = () => <div>analytics-section</div>

const CustomSection = () => <div>acme-section</div>

// As the host root mounts it, inside the full-registry provider.
const HarnessWithHostWidgets: ComponentType<Record<string, unknown>> = () => (
  <HostWidgetsProvider
    widgets={{
      [SHELL_SETTINGS_PAGE_WIDGET]: SettingsPageWidget,
      "analytics:settings": ForeignSection,
      "acme:settings": CustomSection,
    }}
  >
    <Camunda7StandaloneShell>
      <DrillProbe />
    </Camunda7StandaloneShell>
  </HostWidgetsProvider>
)

const PROFILE_FEED = {
  profile: {
    id: "sess-1",
    language: "en",
    pinnedDashboardIds: [],
    analyticsDefaultPeriod: "7d",
    analyticsMinBucketSize: 10,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
  },
  availableEngines: [{ id: "prod-a", environment: "default" }],
  canSave: true,
}

const INSTANCES_FEED = {
  processDefinitionKey: "invoice",
  processDefinitionName: null,
  totalCount: 0,
  returnedCount: 0,
  withIncidentCount: 0,
  suspendedCount: 0,
  instances: [],
  filters: {},
  engineId: "prod-a",
}

function renderShell(
  tools: Record<string, unknown>,
  actions: HostActionLog[],
  widget: ComponentType<Record<string, unknown>> = Harness,
) {
  return render(
    <WidgetFixtureHost
      widget={widget}
      data={{}}
      tools={tools}
      onHostAction={(action) => actions.push(action)}
    />,
  )
}

const followUps = (actions: HostActionLog[]) =>
  actions.filter((a) => a.type === "sendFollowUpMessage")

const originHidden = () => screen.getByText("origin-content").closest("[hidden]") !== null

function harnessWithFullscreen(displayMode: string, requests: string[]) {
  const control = {
    displayMode,
    canFullscreen: true,
    request: (mode: string) => requests.push(mode),
  }
  const Widget: ComponentType<Record<string, unknown>> = () => (
    <DisplayModeControlProvider control={control}>
      <Harness />
    </DisplayModeControlProvider>
  )
  return Widget
}

describe("Camunda7StandaloneShell", () => {
  // #344 N109: the origin's toolbar is hidden while drilled, so the drill brings its own fullscreen switch.
  it("offers fullscreen in a drill, and the way back from it", async () => {
    const requests: string[] = []
    renderShell({}, [], harnessWithFullscreen("inline", requests))
    expect(screen.queryByRole("button", { name: "Fullscreen" })).toBeNull()

    fireEvent.click(screen.getByText("drill-settings"))
    fireEvent.click(await screen.findByRole("button", { name: "Fullscreen" }))
    expect(requests).toEqual(["fullscreen"])

    cleanup()
    renderShell({}, [], harnessWithFullscreen("fullscreen", requests))
    fireEvent.click(screen.getByText("drill-settings"))
    fireEvent.click(await screen.findByRole("button", { name: "Exit fullscreen" }))
    expect(requests).toEqual(["fullscreen", "inline"])
  })

  // #344 N107: a drill and a pop move focus to the view shown and name it.
  it("moves focus to the drilled view and names it, and back on a pop", async () => {
    renderShell({}, [])
    fireEvent.click(screen.getByText("drill-settings"))
    await screen.findByRole("navigation", { name: "Breadcrumb" })
    const frame = document.activeElement as HTMLElement
    expect(frame.getAttribute("tabindex")).toBe("-1")
    expect(within(frame).getAllByRole("status")[0]?.textContent).toBe("Settings")

    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    expect(document.activeElement).toBe(frame)
    expect(within(frame).getAllByRole("status")[0]?.textContent).toBe("Start")
  })

  it("offers no fullscreen switch where the host has none", async () => {
    renderShell({}, [])
    fireEvent.click(screen.getByText("drill-settings"))
    await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(screen.queryByRole("button", { name: "Fullscreen" })).toBeNull()
  })

  it("renders the origin untouched at depth 0 — no trail, no chrome", () => {
    const actions: HostActionLog[] = []
    renderShell({}, actions)
    expect(originHidden()).toBe(false)
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(followUps(actions)).toHaveLength(0)
  })

  it("drills client-side without a chat follow-up and keeps the origin mounted", async () => {
    const actions: HostActionLog[] = []
    renderShell({ camunda7_settings_data: PROFILE_FEED }, actions)

    fireEvent.click(screen.getByText("drill-settings"))

    const trail = await screen.findByRole("navigation", { name: "Breadcrumb" })
    // The fixture output carries no title, so the root crumb is the fallback.
    expect(trail.textContent).toContain("Start")
    expect(trail.textContent).toContain("Settings")
    expect(originHidden()).toBe(true)
    expect(followUps(actions)).toHaveLength(0)
  })

  it("resolves a composed view's FOREIGN section widget from the host registry", async () => {
    const actions: HostActionLog[] = []
    renderShell({ camunda7_settings_data: PROFILE_FEED }, actions, HarnessWithHostWidgets)

    fireEvent.click(screen.getByText("drill-settings"))

    await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(await screen.findByText("analytics-section")).toBeTruthy()
    expect(await screen.findByText("acme-section")).toBeTruthy()
  })

  it("degrades to own widgets when the host provides no registry", async () => {
    const actions: HostActionLog[] = []
    renderShell({ camunda7_settings_data: PROFILE_FEED }, actions)

    fireEvent.click(screen.getByText("drill-settings"))

    await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(screen.queryByText("analytics-section")).toBeNull()
  })

  it("pops back to the origin via the root crumb", async () => {
    const actions: HostActionLog[] = []
    renderShell({ camunda7_settings_data: PROFILE_FEED }, actions)

    fireEvent.click(screen.getByText("drill-settings"))
    await screen.findByRole("navigation", { name: "Breadcrumb" })

    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    expect(originHidden()).toBe(false)
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("resolves the engine via the engines feed when the tool result carries no echo", async () => {
    const actions: HostActionLog[] = []
    renderShell(
      {
        camunda7_list_engines: { engines: [{ id: "prod-a" }], defaultEngineId: "prod-a" },
        camunda7_process_instances_data: INSTANCES_FEED,
      },
      actions,
    )

    fireEvent.click(screen.getByText("drill-instances"))

    const trail = await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(trail.textContent).toContain("Instances")
    expect(followUps(actions)).toHaveLength(0)
  })

  it("keeps the way back available while the engines query never settles", async () => {
    const actions: HostActionLog[] = []
    renderShell(
      {
        // A hanging call (approval gate, broken transport) must not trap the user on loading.
        camunda7_list_engines: () => new Promise(() => {}),
      },
      actions,
    )

    fireEvent.click(screen.getByText("drill-instances"))

    const trail = await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(trail.textContent).toContain("Start")
    expect(screen.getByText("Loading engines…")).toBeTruthy()
    expect(followUps(actions)).toHaveLength(0)

    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    expect(originHidden()).toBe(false)
  })

  it("falls back to the conversational transport when no engine is resolvable", async () => {
    const actions: HostActionLog[] = []
    renderShell(
      {
        // Multi-engine, no default saved: the shell cannot pick one.
        camunda7_list_engines: { engines: [{ id: "a" }, { id: "b" }], defaultEngineId: null },
      },
      actions,
    )

    fireEvent.click(screen.getByText("drill-instances"))

    await waitFor(() => expect(followUps(actions)).toHaveLength(1))
    const prompt = (followUps(actions)[0] as { prompt: string }).prompt
    expect(prompt).toContain("camunda7_show_process_instances")
    // The trail resets — the origin is visible again, exactly like before.
    expect(originHidden()).toBe(false)
    expect(screen.queryByRole("navigation")).toBeNull()
  })
})

describe("findStepEngineId", () => {
  it("finds the engine echo in a production-shaped structuredContent", () => {
    expect(
      findStepEngineId({
        layout: [],
        context: {
          stepData: {
            result: { _dataType: "camunda7:processList", data: { engineId: "prod-a" } },
          },
        },
      }),
    ).toBe("prod-a")
  })

  it("returns undefined for results without an echo", () => {
    expect(findStepEngineId(null)).toBeUndefined()
    expect(findStepEngineId({ context: { stepData: { s: { data: {} } } } })).toBeUndefined()
    expect(findStepEngineId({ context: {} })).toBeUndefined()
  })
})
