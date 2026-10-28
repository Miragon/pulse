// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { CockpitAppData, EngineHealthData } from "../../view-models.js"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import {
  CAMUNDA7_COCKPIT_OVERVIEW_DATA,
  CAMUNDA7_ENGINE_HEALTH_DATA,
  CAMUNDA7_LIST_ENGINES,
  CAMUNDA7_SELECT_ENGINE,
} from "../../tool-names.js"
import { camunda7Instructions } from "../../instructions.js"
import { CockpitApp } from "./app.js"

const toolkitDefaults = queryClient.getDefaultOptions()

beforeEach(() => {
  queryClient.setDefaultOptions({
    ...toolkitDefaults,
    queries: { ...toolkitDefaults.queries, retry: false },
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions(toolkitDefaults)
})

const ENGINES = [
  { id: "prod-a", environment: "default" },
  { id: "prod-b", environment: "default" },
]

/** `list` is mutable, so a test can reload it. */
function renderCockpit(
  bootstrap: CockpitAppData = { engineId: null, engines: ENGINES },
  list: { engines: CockpitAppData["engines"] } = { engines: ENGINES },
) {
  const listCalls: Array<Record<string, unknown>> = []
  const selectCalls: Array<Record<string, unknown>> = []
  const modelContexts: string[] = []
  const listEngines = (args: Record<string, unknown>) => {
    listCalls.push(args)
    return { engines: list.engines, environments: [], defaultEngineId: "prod-b" }
  }
  const selectEngine = (args: Record<string, unknown>) => {
    selectCalls.push(args)
    return { defaultEngineId: args.engineId ?? null }
  }
  const overview = (args: Record<string, unknown>) => ({
    summary: {
      totalDefinitions: 0,
      totalRunningInstances: 0,
      totalFailedJobs: 0,
      totalIncidents: 0,
    },
    definitions: [],
    engineId: args.engine,
  })
  const health = (args: Record<string, unknown>): EngineHealthData => ({
    status: "ok",
    statusRule: "ok without open incidents",
    summary: {
      totalIncidents: 0,
      lastHourIncidents: 0,
      last24hIncidents: 0,
      affectedActivities: 0,
      affectedDefinitions: 0,
      runningInstances: 3,
      totalDefinitions: 1,
      started24h: null,
      completed24h: null,
    },
    clusters: [],
    fetchedAt: "2026-06-11T14:05:00.000Z",
    engineId: String(args.engine),
  })
  const Cockpit: ComponentType<Record<string, unknown>> = () => <CockpitApp data={bootstrap} />
  render(
    <WidgetFixtureHost
      widget={Cockpit}
      data={{}}
      tools={{
        [CAMUNDA7_LIST_ENGINES]: listEngines,
        [CAMUNDA7_SELECT_ENGINE]: selectEngine,
        [CAMUNDA7_COCKPIT_OVERVIEW_DATA]: overview,
        [CAMUNDA7_ENGINE_HEALTH_DATA]: health,
      }}
      onModelContext={(text) => modelContexts.push(text)}
    />,
  )
  return { listCalls, selectCalls, modelContexts }
}

describe("CockpitApp navigation is side-effect free", () => {
  it("entering and switching engines never writes the saved default engine", async () => {
    const { listCalls, selectCalls } = renderCockpit()

    fireEvent.click(await screen.findByRole("button", { name: /prod-a/ }))
    const switcher = await screen.findByLabelText("Selected engine")
    fireEvent.change(switcher, { target: { value: "prod-b" } })
    await waitFor(() => expect((switcher as HTMLSelectElement).value).toBe("prod-b"))

    expect(listCalls).toContainEqual({})
    // Making an engine the default is an explicit settings action.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(selectCalls).toEqual([])
  })

  // Navigation no longer moves the saved default, so the model must learn the viewed engine.
  it("tells the model which engine the operator is viewing — and to pin it", async () => {
    const { modelContexts } = renderCockpit()
    fireEvent.click(await screen.findByRole("button", { name: /prod-a/ }))
    await waitFor(() => expect(modelContexts.at(-1)).toContain('Ids: engine="prod-a"'))
    const instructions = camunda7Instructions({
      engineIds: ["prod-a", "prod-b"],
      canSaveDefault: true,
      toolset: "operations",
    })
    expect(instructions).toContain(
      "widget model contexts (the view the operator is on) carry Ids/Tools lines: while one names a single `engine`, pass it on every camunda7 call",
    )
  })
})

const activeEngine = () =>
  screen.queryByLabelText<HTMLSelectElement>("Selected engine")?.value ?? null
const onLanding = () =>
  screen.queryByRole("heading", { level: 1, name: "Operations Cockpit" }) !== null

/** #341 K43 / N105: opens where `camunda7_open_cockpit` resolved, and the context says what is shown. */
describe("CockpitApp opens on the bootstrap's engine", () => {
  it("a resolved engine (per-call `engine` or saved default): lands on it, not on the picker", async () => {
    const { modelContexts } = renderCockpit({ engineId: "prod-a", engines: ENGINES })
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    expect(onLanding()).toBe(false)
    await waitFor(() => expect(modelContexts.at(-1)).toContain('Ids: engine="prod-a"'))
  })

  it("a single engine: lands on it", async () => {
    const solo = [{ id: "solo", environment: "default" }]
    const { modelContexts } = renderCockpit({ engineId: "solo", engines: solo }, { engines: solo })
    await waitFor(() => expect(modelContexts.at(-1)).toContain('Ids: engine="solo"'))
    expect(onLanding()).toBe(false)
  })

  it("no resolved engine: the picker — and the model hears it is on the picker", async () => {
    const { modelContexts } = renderCockpit()
    expect(onLanding()).toBe(true)
    await waitFor(() => expect(modelContexts.at(-1)).toContain("engine picker"))
    const last = modelContexts.at(-1)!
    expect(last).not.toMatch(/Ids: engine="/)
    expect(last).toContain('engines=["prod-a","prod-b"]')
  })
})

/** #341 N106 */
describe("CockpitApp reconciles its engine scope with the engine list", () => {
  const THREE = [...ENGINES, { id: "prod-c", environment: "default" }]

  async function reloadEngines(list: { engines: CockpitAppData["engines"] }, next: typeof THREE) {
    list.engines = next
    await queryClient.invalidateQueries({ queryKey: ["camunda7:engines"] })
  }

  it("the open engine leaves the list, two remain: back to the picker, saying why", async () => {
    const list = { engines: THREE }
    const { modelContexts } = renderCockpit({ engineId: "prod-a", engines: THREE }, list)
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))

    await reloadEngines(list, THREE.slice(1))

    await waitFor(() => expect(onLanding()).toBe(true))
    expect(screen.getByText(/prod-a is no longer in your engine list/)).toBeTruthy()
    await waitFor(() => expect(modelContexts.at(-1)).toContain("engine picker"))
  })

  it("the open engine leaves the list, one remains: opens on it", async () => {
    const list = { engines: ENGINES }
    const { modelContexts } = renderCockpit({ engineId: "prod-a", engines: ENGINES }, list)
    await waitFor(() => expect(modelContexts.at(-1)).toContain('Ids: engine="prod-a"'))

    await reloadEngines(list, [ENGINES[1]])

    await waitFor(() => expect(modelContexts.at(-1)).toContain('Ids: engine="prod-b"'))
    expect(screen.getByText(/prod-a is no longer in your engine list/)).toBeTruthy()
  })

  it("a bootstrap engine the loaded list does not carry falls back the same way", async () => {
    renderCockpit({ engineId: "prod-a", engines: THREE }, { engines: THREE.slice(1) })
    await waitFor(() => expect(onLanding()).toBe(true))
    expect(screen.getByText(/prod-a is no longer in your engine list/)).toBeTruthy()
  })
})

/** #322 U4, U15, U20, U27 */
describe("CockpitApp head", () => {
  const ENVIRONMENTS = [
    { id: "prod-a", environment: "prod" },
    { id: "test-a", environment: "test" },
  ]

  it("names the engine and its environment as a text chip", async () => {
    renderCockpit({ engineId: "prod-a", engines: ENVIRONMENTS }, { engines: ENVIRONMENTS })
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    const chip = document.querySelector(
      "[data-slot='engine-context'] [data-slot='environment-chip']",
    )
    expect(chip?.textContent).toBe("Environment prod")
    expect(screen.getByRole("group", { name: "PROD" })).toBeTruthy()
  })

  it("'All engines' leads back to the chooser; the last crumb is the current page", async () => {
    renderCockpit({ engineId: "prod-a", engines: ENVIRONMENTS }, { engines: ENVIRONMENTS })
    const trail = await screen.findByRole("navigation", { name: "Breadcrumb" })
    const current = within(trail).getByText("Overview")
    expect(current.getAttribute("aria-current")).toBe("page")
    fireEvent.click(within(trail).getByRole("button", { name: "All engines" }))
    await waitFor(() => expect(onLanding()).toBe(true))
  })

  it("has one refresh control", async () => {
    renderCockpit({ engineId: "prod-a", engines: ENVIRONMENTS }, { engines: ENVIRONMENTS })
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    // The overview header brings its own Refresh outside the cockpit (#322 U27).
    expect(await screen.findByRole("heading", { name: "prod-a · Overview" })).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Refresh" })).toHaveLength(1)
  })

  it("no engines at all: the product signature over the app-level empty state", async () => {
    renderCockpit({ engineId: null, engines: [] }, { engines: [] })
    expect(
      await screen.findByRole("heading", { level: 2, name: "No engines configured" }),
    ).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeTruthy()
    expect(screen.getByText("Pulse")).toBeTruthy()
    expect(document.querySelectorAll("[data-brand-mark='komet']")).toHaveLength(1)
  })
})
