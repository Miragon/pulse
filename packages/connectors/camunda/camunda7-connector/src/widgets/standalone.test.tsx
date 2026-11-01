// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { TestViewHost, type HostAction } from "@miragon/pulse-widget-shell/widgets"
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
      <button
        type="button"
        onClick={() => go({ type: "process-instances", processDefinitionKey: "invoice" })}
      >
        drill-instances
      </button>
    </div>
  )
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
  { engineId, displayMode }: { engineId?: string; displayMode?: string } = {},
) {
  return render(
    <TestViewHost
      tools={tools}
      onHostAction={(action) => actions.push(action)}
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

/** A drill whose engine the view data names, so it stays client-side. */
const INSTANCES = { camunda7_process_instances_data: INSTANCES_FEED }

describe("Camunda7Standalone", () => {
  // The view frame's toolbar stays above a drill, so the drill brings no second fullscreen switch.
  it("offers no fullscreen switch of its own in a drill", async () => {
    renderShell(INSTANCES, [], { engineId: "prod-a", displayMode: "inline" })
    fireEvent.click(screen.getByText("drill-instances"))
    await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(screen.queryByRole("button", { name: "Fullscreen" })).toBeNull()
  })

  // #344 N107: a drill and a pop move focus to the view shown and name it.
  it("moves focus to the drilled view and names it, and back on a pop", async () => {
    renderShell(INSTANCES, [], { engineId: "prod-a" })
    fireEvent.click(screen.getByText("drill-instances"))
    await screen.findByRole("navigation", { name: "Breadcrumb" })
    const frame = document.activeElement as HTMLElement
    expect(frame.getAttribute("tabindex")).toBe("-1")
    expect(within(frame).getAllByRole("status")[0]?.textContent).toBe("Instances")

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
    renderShell(INSTANCES, actions, { engineId: "prod-a" })

    fireEvent.click(screen.getByText("drill-instances"))

    const trail = await screen.findByRole("navigation", { name: "Breadcrumb" })
    expect(trail.textContent).toContain("Start")
    expect(trail.textContent).toContain("Instances")
    expect(originHidden()).toBe(true)
    expect(followUps(actions)).toHaveLength(0)
  })

  it("pops back to the origin via the root crumb", async () => {
    const actions: HostAction[] = []
    renderShell(INSTANCES, actions, { engineId: "prod-a" })

    fireEvent.click(screen.getByText("drill-instances"))
    await screen.findByRole("navigation", { name: "Breadcrumb" })

    fireEvent.click(screen.getByRole("button", { name: "Start" }))
    expect(originHidden()).toBe(false)
    expect(screen.queryByRole("navigation")).toBeNull()
  })

  it("drills on the engine the view data names", async () => {
    const actions: HostAction[] = []
    renderShell(INSTANCES, actions, { engineId: "prod-a" })

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
