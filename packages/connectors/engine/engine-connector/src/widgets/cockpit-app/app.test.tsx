// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type {
  CockpitAppData,
  CockpitStart,
  CockpitView,
  EngineHealthData,
  JobPanelData,
} from "../../view-models.js"
import {
  ENGINE_COCKPIT_OVERVIEW_DATA,
  ENGINE_HEALTH_DATA,
  ENGINE_JOBS_DATA,
  ENGINE_LIST_ENGINES,
} from "../../tool-names.js"
import { engineInstructions } from "../../instructions.js"
import { CockpitApp } from "./app.js"
import {
  TestViewHost,
  createTestQueryClient,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

const ENGINES = [
  { id: "prod-a", environment: "default" },
  { id: "prod-b", environment: "default" },
]

/**
 * A bootstrap as `engine_open_cockpit` returns it. Without a start view, or with a start whose
 * data the test leaves out, the routes fetch.
 */
function boot(
  engineId: string | null,
  engines: CockpitAppData["engines"],
  view: CockpitView | null = null,
  data: CockpitStart["data"] | null = null,
): CockpitAppData {
  return { engineId, engines, start: view ? ({ view, data } as CockpitStart) : null }
}

/** Stable objects: the test host memoizes on them. Fullscreen shows the head and the trail apart. */
const FULLSCREEN = { displayMode: "fullscreen" } as const
const INLINE = { displayMode: "inline" } as const

/** `list` is mutable, so a test can reload it. */
function renderCockpit(
  bootstrap: CockpitAppData = boot(null, ENGINES),
  list: { engines: CockpitAppData["engines"] } = { engines: ENGINES },
  displayMode: typeof FULLSCREEN | typeof INLINE = FULLSCREEN,
) {
  const modelContexts: string[] = []
  const actions: HostAction[] = []
  const listEngines = () => ({ engines: list.engines, environments: [], defaultEngineId: "prod-b" })
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
  const tools = {
    [ENGINE_LIST_ENGINES]: listEngines,
    [ENGINE_COCKPIT_OVERVIEW_DATA]: overview,
    [ENGINE_HEALTH_DATA]: health,
    [ENGINE_JOBS_DATA]: () => JOBS_DATA,
  }
  const host = (data: CockpitAppData) => (
    <TestViewHost
      tools={tools}
      onModelContext={(text) => modelContexts.push(text)}
      onHostAction={(action) => actions.push(action)}
      client={queryClient}
      host={displayMode}
    >
      <CockpitApp data={data} />
    </TestViewHost>
  )
  const { rerender } = render(host(bootstrap))
  /** The host delivers another tool result to the same view. */
  const redeliver = (data: CockpitAppData) => rerender(host(data))
  const reads = (feed: string) =>
    actions.flatMap((a) => (a.type === "callTool" && a.name === feed ? [a.args] : []))
  return { modelContexts, redeliver, reads }
}

describe("CockpitApp navigation is side-effect free", () => {
  // Navigation never moves the default engine, so the model must learn the viewed engine.
  it("tells the model which engine the operator is viewing — and to pin it", async () => {
    const { modelContexts } = renderCockpit()
    fireEvent.click(await screen.findByRole("button", { name: /prod-a/ }))
    await waitFor(() => expect(modelContexts.at(-1)).toContain('Ids: engine="prod-a"'))
    const instructions = engineInstructions({
      engineIds: ["prod-a", "prod-b"],
      toolset: "operations",
    })
    expect(instructions).toContain(
      "widget model contexts (the view the operator is on) carry an Ids line: while it names a single `engine`, pass it on every engine call",
    )
  })
})

const activeEngine = () =>
  screen.queryByLabelText<HTMLSelectElement>("Selected engine")?.value ?? null
const onLanding = () =>
  screen.queryByRole("heading", { level: 1, name: "Operations Cockpit" }) !== null

/** #341 K43 / N105: opens where `engine_open_cockpit` resolved, and the context says what is shown. */
describe("CockpitApp opens on the bootstrap's engine", () => {
  it("a resolved engine (per-call `engine` or default engine): lands on it, not on the picker", async () => {
    const { modelContexts } = renderCockpit(boot("prod-a", ENGINES))
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    expect(onLanding()).toBe(false)
    await waitFor(() => expect(modelContexts.at(-1)).toContain('Ids: engine="prod-a"'))
  })

  it("a single engine: lands on it", async () => {
    const solo = [{ id: "solo", environment: "default" }]
    const { modelContexts } = renderCockpit(boot("solo", solo), { engines: solo })
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
    await queryClient.invalidateQueries({ queryKey: ["engine:engines"] })
  }

  it("the open engine leaves the list, two remain: back to the picker, saying why", async () => {
    const list = { engines: THREE }
    const { modelContexts } = renderCockpit(boot("prod-a", THREE), list)
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))

    await reloadEngines(list, THREE.slice(1))

    await waitFor(() => expect(onLanding()).toBe(true))
    expect(screen.getByText(/prod-a is no longer configured on this server/)).toBeTruthy()
    await waitFor(() => expect(modelContexts.at(-1)).toContain("engine picker"))
  })

  it("the open engine leaves the list, one remains: opens on it", async () => {
    const list = { engines: ENGINES }
    const { modelContexts } = renderCockpit(boot("prod-a", ENGINES), list)
    await waitFor(() => expect(modelContexts.at(-1)).toContain('Ids: engine="prod-a"'))

    await reloadEngines(list, [ENGINES[1]])

    await waitFor(() => expect(modelContexts.at(-1)).toContain('Ids: engine="prod-b"'))
    expect(screen.getByText(/prod-a is no longer configured on this server/)).toBeTruthy()
  })

  it("a bootstrap engine the loaded list does not carry falls back the same way", async () => {
    renderCockpit(boot("prod-a", THREE), { engines: THREE.slice(1) })
    await waitFor(() => expect(onLanding()).toBe(true))
    expect(screen.getByText(/prod-a is no longer configured on this server/)).toBeTruthy()
  })
})

/** #322 U4, U15, U20, U27 */
describe("CockpitApp head", () => {
  const ENVIRONMENTS = [
    { id: "prod-a", environment: "prod" },
    { id: "test-a", environment: "test" },
  ]

  it("names the engine and its environment as a text chip", async () => {
    renderCockpit(boot("prod-a", ENVIRONMENTS), { engines: ENVIRONMENTS })
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    const chip = document.querySelector(
      "[data-slot='engine-context'] [data-slot='environment-chip']",
    )
    expect(chip?.textContent).toBe("Environment prod")
    expect(screen.getByRole("group", { name: "PROD" })).toBeTruthy()
  })

  it("'All engines' leads back to the chooser; the last crumb is the current page", async () => {
    renderCockpit(boot("prod-a", ENVIRONMENTS), { engines: ENVIRONMENTS })
    const trail = await screen.findByRole("navigation", { name: "Breadcrumb" })
    const current = within(trail).getByText("Overview")
    expect(current.getAttribute("aria-current")).toBe("page")
    fireEvent.click(within(trail).getByRole("button", { name: "All engines" }))
    await waitFor(() => expect(onLanding()).toBe(true))
  })

  it("has one refresh control", async () => {
    renderCockpit(boot("prod-a", ENVIRONMENTS), { engines: ENVIRONMENTS })
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    // The head holds the one Refresh (#322 U27); the overview header brings none of its own.
    expect(await screen.findByRole("heading", { name: "prod-a · Overview" })).toBeTruthy()
    expect(screen.getAllByRole("button", { name: "Refresh" })).toHaveLength(1)
  })

  it("no engines at all: the product signature over the app-level empty state", async () => {
    renderCockpit(boot(null, []), { engines: [] })
    expect(
      await screen.findByRole("heading", { level: 2, name: "No engines configured" }),
    ).toBeTruthy()
    expect(screen.getByRole("heading", { level: 1, name: "Operations Cockpit" })).toBeTruthy()
    expect(screen.getByText("Pulse")).toBeTruthy()
    expect(document.querySelectorAll("[data-brand-mark='komet']")).toHaveLength(1)
  })
})

const JOBS_DATA: JobPanelData = {
  totalCount: 0,
  failedCount: 0,
  jobs: [],
  filters: {},
  engineId: "prod-a",
}

const headSection = (name: string) =>
  within(screen.getByRole("navigation", { name: "Cockpit sections" })).getByRole("button", {
    name,
  })

const trailLabels = () =>
  Array.from(
    screen
      .getByRole("navigation", { name: "Breadcrumb" })
      .querySelectorAll("button, [aria-current='page']"),
  )
    .map((el) => el.textContent)
    .filter((text): text is string => !!text)

/** The start view `engine_open_cockpit` names: where the cockpit opens, seeded with its data. */
describe("CockpitApp opens on the start view", () => {
  it("a head section's start is current in the head, with no picker", async () => {
    renderCockpit(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA))
    await waitFor(() => expect(headSection("Jobs").getAttribute("aria-current")).toBe("page"))
    expect(headSection("Overview").getAttribute("aria-current")).toBeNull()
    expect(onLanding()).toBe(false)
  })

  it("renders the start view from its seed without a feed call", async () => {
    const { reads } = renderCockpit(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA))
    expect(await screen.findByText("No jobs in this selection.")).toBeTruthy()
    expect(reads(ENGINE_JOBS_DATA)).toEqual([])
  })

  it("a start below the head sections sits under the overview crumb", async () => {
    renderCockpit(
      boot("prod-a", ENGINES, { section: "process-instances", processDefinitionKey: "invoice" }),
    )
    await waitFor(() => expect(trailLabels()).toEqual(["All engines", "Overview", "Instances"]))
    expect(headSection("Overview").getAttribute("aria-current")).toBe("page")
  })

  it("another view gets no seed: it reads its own feeds", async () => {
    const { reads } = renderCockpit(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA))
    fireEvent.click(await screen.findByRole("button", { name: "Overview" }))
    await waitFor(() => expect(reads(ENGINE_HEALTH_DATA)).toEqual([{ engine: "prod-a" }]))
    expect(reads(ENGINE_JOBS_DATA)).toEqual([])
  })

  it("another engine gets no seed: it reads on that engine", async () => {
    const { reads } = renderCockpit(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA))
    await waitFor(() => expect(activeEngine()).toBe("prod-a"))
    fireEvent.change(screen.getByLabelText("Selected engine"), { target: { value: "prod-b" } })
    await waitFor(() => expect(reads(ENGINE_HEALTH_DATA)).toEqual([{ engine: "prod-b" }]))
  })

  it("the Jobs head section resets the stack", async () => {
    renderCockpit(
      boot("prod-a", ENGINES, { section: "process-instances", processDefinitionKey: "invoice" }),
    )
    await waitFor(() => expect(trailLabels()).toContain("Instances"))
    fireEvent.click(headSection("Jobs"))
    await waitFor(() => expect(headSection("Jobs").getAttribute("aria-current")).toBe("page"))
    expect(trailLabels()).toEqual(["All engines", "Jobs"])
  })

  it("a re-delivered bootstrap with another start view lands on that view", async () => {
    const { redeliver } = renderCockpit(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA))
    await waitFor(() => expect(headSection("Jobs").getAttribute("aria-current")).toBe("page"))
    redeliver(boot("prod-a", ENGINES, { section: "incidents" }))
    await waitFor(() => expect(headSection("Incidents").getAttribute("aria-current")).toBe("page"))
    expect(trailLabels()).toEqual(["All engines", "Incidents"])
  })

  // `viewKey` ignores the focus, so the boot key must not.
  it("a re-delivered bootstrap that differs only by the focus opens on that focus", async () => {
    const detail = { section: "process-detail", processDefinitionKey: "invoice" } as const
    const { redeliver } = renderCockpit(boot("prod-a", ENGINES, detail))
    await waitFor(() => expect(trailLabels()).toEqual(["All engines", "Overview", "invoice"]))
    fireEvent.click(
      within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("Overview"),
    )
    await waitFor(() => expect(trailLabels()).toEqual(["All engines", "Overview"]))
    redeliver(boot("prod-a", ENGINES, { ...detail, focus: "incidents" }))
    await waitFor(() => expect(trailLabels()).toEqual(["All engines", "Overview", "invoice"]))
  })

  // The seed is the tool call's snapshot: after the user left the start view, a cache entry
  // TanStack has collected (gcTime) must not come back as fresh data.
  it("a later visit to the start view reads live, never the tool call's snapshot again", async () => {
    const { reads } = renderCockpit(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA))
    expect(await screen.findByText("No jobs in this selection.")).toBeTruthy()
    fireEvent.click(headSection("Overview"))
    await waitFor(() => expect(reads(ENGINE_HEALTH_DATA)).toEqual([{ engine: "prod-a" }]))
    queryClient.removeQueries({ queryKey: ["engine:jobs"] })
    fireEvent.click(headSection("Jobs"))
    await waitFor(() => expect(reads(ENGINE_JOBS_DATA)).toHaveLength(1))
    expect(reads(ENGINE_JOBS_DATA)[0]).toMatchObject({ engine: "prod-a" })
  })
})

/** #396: inline is a card, so the head and the trail share one row. */
describe("CockpitApp inline", () => {
  const sections = () => screen.queryByRole("navigation", { name: "Cockpit sections" })
  const trail = () => screen.queryByRole("navigation", { name: "Breadcrumb" })

  it("a drilled view's trail takes the sections' place in the head", async () => {
    const instances = { section: "process-instances", processDefinitionKey: "invoice" } as const
    renderCockpit(boot("prod-a", ENGINES, instances), { engines: ENGINES }, INLINE)
    await waitFor(() => expect(trailLabels()).toEqual(["All engines", "Overview", "Instances"]))
    expect(sections()).toBeNull()
  })

  it("a head section shows its sections and no trail", async () => {
    renderCockpit(boot("prod-a", ENGINES, { section: "jobs" }, JOBS_DATA), undefined, INLINE)
    await waitFor(() => expect(headSection("Jobs").getAttribute("aria-current")).toBe("page"))
    expect(trail()).toBeNull()
  })

  it("the trail's first crumb leads back to the sections", async () => {
    const detail = { section: "process-detail", processDefinitionKey: "invoice" } as const
    renderCockpit(boot("prod-a", ENGINES, detail), undefined, INLINE)
    fireEvent.click(
      within(await screen.findByRole("navigation", { name: "Breadcrumb" })).getByText("Overview"),
    )
    await waitFor(() => expect(headSection("Overview").getAttribute("aria-current")).toBe("page"))
    expect(trail()).toBeNull()
  })
})
