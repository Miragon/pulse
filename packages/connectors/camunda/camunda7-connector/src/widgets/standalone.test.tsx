// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  TestViewHost,
  type HostAction,
  type HostWidgets,
} from "@miragon/pulse-widget-shell/widgets"
import { useNav } from "./navigation.js"
import { Camunda7Standalone } from "./standalone.js"

afterEach(() => {
  cleanup()
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

const ForeignSection = () => <div>analytics-section</div>

const CustomSection = () => <div>acme-section</div>

// As the bundle root mounts it, with every module's settings section.
const HOST_WIDGETS: HostWidgets = {
  "analytics:settings": ForeignSection,
  "acme:settings": CustomSection,
}

const PROFILE_FEED = {
  profile: {
    id: "sess-1",
    language: "en",
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
  actions: HostAction[],
  {
    engineId,
    hostWidgets,
    displayMode,
  }: { engineId?: string; hostWidgets?: HostWidgets; displayMode?: string } = {},
) {
  return render(
    <TestViewHost
      tools={tools}
      onHostAction={(action) => actions.push(action)}
      hostWidgets={hostWidgets}
      host={displayMode ? { displayMode, availableDisplayModes: ["inline", "fullscreen"] } : {}}
    >
      <Camunda7Standalone engineId={engineId}>
        <DrillProbe />
      </Camunda7Standalone>
    </TestViewHost>,
  )
}

const followUps = (actions: HostAction[]) => actions.filter((a) => a.type === "sendFollowUp")

const originHidden = () => screen.getByText("origin-content").closest("[hidden]") !== null

describe("Camunda7Standalone", () => {
  // The view frame's toolbar stays above a drill, so the drill brings no second fullscreen switch.
  it("offers no fullscreen switch of its own in a drill", async () => {
    renderShell({}, [], { displayMode: "inline" })
    fireEvent.click(screen.getByText("drill-settings"))
    await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(screen.queryByRole("button", { name: "Fullscreen" })).toBeNull()
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

  it("renders the origin untouched at depth 0, no trail, no chrome", () => {
    const actions: HostAction[] = []
    renderShell({}, actions)
    expect(originHidden()).toBe(false)
    expect(screen.queryByRole("navigation")).toBeNull()
    expect(followUps(actions)).toHaveLength(0)
  })

  it("drills client-side without a chat follow-up and keeps the origin mounted", async () => {
    const actions: HostAction[] = []
    renderShell({ camunda7_settings_data: PROFILE_FEED }, actions)

    fireEvent.click(screen.getByText("drill-settings"))

    const trail = await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(trail.textContent).toContain("Start")
    expect(trail.textContent).toContain("Settings")
    expect(originHidden()).toBe(true)
    expect(followUps(actions)).toHaveLength(0)
  })

  it("renders every module's settings section on the drilled settings page", async () => {
    const actions: HostAction[] = []
    renderShell({ camunda7_settings_data: PROFILE_FEED }, actions, { hostWidgets: HOST_WIDGETS })

    fireEvent.click(screen.getByText("drill-settings"))

    await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(await screen.findByText("analytics-section")).toBeTruthy()
    expect(await screen.findByText("acme-section")).toBeTruthy()
  })

  it("renders no foreign section when the bundle has none", async () => {
    const actions: HostAction[] = []
    renderShell({ camunda7_settings_data: PROFILE_FEED }, actions)

    fireEvent.click(screen.getByText("drill-settings"))

    await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(screen.queryByText("analytics-section")).toBeNull()
  })

  it("pops back to the origin via the root crumb", async () => {
    const actions: HostAction[] = []
    renderShell({ camunda7_settings_data: PROFILE_FEED }, actions)

    fireEvent.click(screen.getByText("drill-settings"))
    await screen.findByRole("navigation", { name: "Breadcrumb" })

    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    expect(originHidden()).toBe(false)
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("drills on the engine the view data names", async () => {
    const actions: HostAction[] = []
    renderShell({ camunda7_process_instances_data: INSTANCES_FEED }, actions, {
      engineId: "prod-a",
    })

    fireEvent.click(screen.getByText("drill-instances"))

    await screen.findByRole("navigation", { name: "Breadcrumb" })
    await waitFor(() =>
      expect(actions).toContainEqual({
        type: "callTool",
        name: "camunda7_process_instances_data",
        args: expect.objectContaining({ engine: "prod-a" }) as unknown,
      }),
    )
    expect(followUps(actions)).toHaveLength(0)
  })

  it("resolves the engine via the engines feed when the view data carries no echo", async () => {
    const actions: HostAction[] = []
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
    const actions: HostAction[] = []
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

  it("falls back to a chat follow-up when no engine is resolvable", async () => {
    const actions: HostAction[] = []
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
    // The trail resets: the origin is visible again, exactly like before.
    expect(originHidden()).toBe(false)
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("falls back to the chat when the engines feed fails", async () => {
    const actions: HostAction[] = []
    renderShell(
      {
        camunda7_list_engines: () => {
          throw new Error("Tool camunda7_list_engines not found")
        },
      },
      actions,
    )

    fireEvent.click(screen.getByText("drill-instances"))

    await waitFor(() => expect(followUps(actions)).toHaveLength(1))
    expect(originHidden()).toBe(false)
  })
})
