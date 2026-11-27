// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { DEFAULT_VERDICT_THRESHOLDS, engineVerdict } from "@miragon/pulse-c7-core"
import { SITUATION_TONES, TONE_DOT, TONE_ICON, type ToneVariant } from "@miragon/pulse-ui"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_HEALTH_DATA } from "../../tool-names.js"
import type { CockpitDashboardData, EngineHealthData } from "../../view-models.js"
import { FleetView } from "./fleet-view.js"
import { LandingChooser } from "./landing.js"

// D5: one live verdict per engine. The dot on the landing and the fleet view is the overview
// badge's verdict (the health feed's `status`), not "any incident or failed job is danger".

let queryClient = createTestQueryClient()
afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

interface EngineCounts {
  openRootIncidents: number
  largestCause: number
  failedJobs: number
  running: number
}

const ENGINES: Record<string, EngineCounts> = {
  "one-incident": { openRootIncidents: 1, largestCause: 1, failedJobs: 0, running: 10 },
  "at-threshold": {
    openRootIncidents: DEFAULT_VERDICT_THRESHOLDS.criticalIncidents,
    largestCause: 3,
    failedJobs: 0,
    running: 10,
  },
  "stuck-jobs": { openRootIncidents: 0, largestCause: 0, failedJobs: 4, running: 10 },
  steady: { openRootIncidents: 0, largestCause: 0, failedJobs: 0, running: 10 },
  idle: { openRootIncidents: 0, largestCause: 0, failedJobs: 0, running: 0 },
}

const countsOf = (args: Record<string, unknown>) => ENGINES[String(args.engine)]

function overviewFeed(args: Record<string, unknown>): CockpitDashboardData {
  const e = countsOf(args)
  return {
    summary: {
      totalDefinitions: 2,
      totalRunningInstances: e.running,
      totalFailedJobs: e.failedJobs,
      totalIncidents: e.openRootIncidents,
    },
    // The fleet's rows count from the definitions, the landing's words from the summary.
    definitions: [
      {
        id: "p:1:d",
        key: "p",
        name: "P",
        latestVersion: 1,
        instances: e.running,
        failedJobs: e.failedJobs,
        incidents:
          e.openRootIncidents > 0
            ? [{ incidentType: "failedJob", incidentCount: e.openRootIncidents }]
            : [],
      },
    ],
    engineId: String(args.engine),
  }
}

/** The verdict as the health feed's builder computes it: c7-core's, on the default thresholds. */
function healthFeed(args: Record<string, unknown>): EngineHealthData {
  const e = countsOf(args)
  return {
    status: engineVerdict(
      { openRootIncidents: e.openRootIncidents, largestCluster: e.largestCause },
      DEFAULT_VERDICT_THRESHOLDS,
    ),
    statusRule: "",
    summary: {
      totalIncidents: e.openRootIncidents,
      lastHourIncidents: 0,
      affectedActivities: null,
      affectedDefinitions: 0,
      runningInstances: e.running,
      totalDefinitions: 2,
      started24h: null,
      completed24h: null,
      historyRecorded: null,
    },
    clusters: [],
    fetchedAt: "2026-11-04T08:00:00.000Z",
    engineId: String(args.engine),
  }
}

const TOOLS = { [ENGINE_COCKPIT_OVERVIEW_DATA]: overviewFeed, [ENGINE_HEALTH_DATA]: healthFeed }
const engines = Object.keys(ENGINES).map((id) => ({ id }))

const TONES = Object.keys(TONE_DOT) as ToneVariant[]
function dotTone(container: HTMLElement): ToneVariant | undefined {
  const dot = container.querySelector("[data-part='verdict']")
  return TONES.find((tone) => dot?.classList.contains(TONE_DOT[tone]))
}

async function landingRow(engineId: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: new RegExp(`^${engineId}\\s*,`) })
}

/** The engine's row of the "Per engine" table, which opens it (N8): its dot before its id. */
function fleetRow(engineId: string): HTMLElement {
  const table = screen.getByRole("region", { name: "Load and job backlog per engine" })
  const rows = within(table)
    .getAllByText(engineId, { selector: "span" })
    .flatMap((name) => name.closest("tr") ?? [])
  expect(rows).toHaveLength(1)
  return rows[0]
}

it("the fixture's verdicts are c7-core's: one incident is warning, the threshold critical", () => {
  expect(healthFeed({ engine: "one-incident" }).status).toBe("warning")
  expect(healthFeed({ engine: "at-threshold" }).status).toBe("critical")
  expect(healthFeed({ engine: "stuck-jobs" }).status).toBe("ok")
})

describe("the landing's engine dot follows the one verdict", () => {
  function renderLanding() {
    render(
      <TestViewHost tools={TOOLS} client={queryClient}>
        <LandingChooser engines={engines} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
  }

  it("one open root incident, no threshold reached: warning, as the overview badge says", async () => {
    renderLanding()
    const row = await landingRow("one-incident")
    await waitFor(() => expect(dotTone(row)).toBe("warning"))
    expect(row.textContent).toContain("1 incident")
  })

  it("at the incident threshold: danger", async () => {
    renderLanding()
    const row = await landingRow("at-threshold")
    await waitFor(() => expect(dotTone(row)).toBe("danger"))
  })

  it("jobs without retries stay named in words but colour only through the verdict", async () => {
    renderLanding()
    const row = await screen.findByRole("button", {
      name: /^stuck-jobs\s*,\s*4 jobs without retries$/,
    })
    await waitFor(() => expect(healthQueryDone("stuck-jobs")).toBe(true))
    expect(dotTone(row)).toBe("neutral")
  })

  it("an engine the verdict calls ok is the table's healthy: neutral, never green", async () => {
    renderLanding()
    const row = await landingRow("steady")
    await waitFor(() => expect(healthQueryDone("steady")).toBe(true))
    expect(dotTone(row)).toBe(SITUATION_TONES.healthy)
    expect(dotTone(row)).toBe("neutral")
  })

  it("an idle engine the verdict calls ok stays neutral, never green", async () => {
    renderLanding()
    const row = await screen.findByRole("button", { name: /^idle\s*,\s*no running instances$/ })
    await waitFor(() => expect(healthQueryDone("idle")).toBe(true))
    expect(dotTone(row)).toBe("neutral")
  })

  it("an engine with nothing deployed whose verdict is no ok shows its dot, never empty", async () => {
    // A root incident outside any process (a batch's, the history cleanup's) counts in the
    // verdict, which the overview's badge and the web app's state show: so does the landing.
    const bare = (args: Record<string, unknown>) => args.engine === "bare"
    const tools = {
      [ENGINE_COCKPIT_OVERVIEW_DATA]: (args: Record<string, unknown>) => {
        const data = overviewFeed(bare(args) ? { engine: "idle" } : args)
        if (!bare(args)) return data
        return { ...data, summary: { ...data.summary, totalDefinitions: 0 }, definitions: [] }
      },
      [ENGINE_HEALTH_DATA]: (args: Record<string, unknown>) => {
        const data = healthFeed(bare(args) ? { engine: "idle" } : args)
        if (!bare(args)) return data
        return {
          ...data,
          status: "warning",
          summary: { ...data.summary, totalDefinitions: 0 },
          engineId: "bare",
        }
      },
    }
    render(
      <TestViewHost tools={tools} client={queryClient}>
        <LandingChooser engines={[{ id: "bare" }, { id: "steady" }]} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    const row = await screen.findByRole("button", { name: /^bare\s*,\s*no running instances$/ })
    await waitFor(() => expect(dotTone(row)).toBe("warning"))
  })

  it("without a verdict the dot is neutral: the counts alone never colour it", async () => {
    render(
      <TestViewHost tools={{ [ENGINE_COCKPIT_OVERVIEW_DATA]: overviewFeed }} client={queryClient}>
        <LandingChooser engines={engines} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    const row = await landingRow("at-threshold")
    await waitFor(() => expect(healthQueryFailed("at-threshold")).toBe(true))
    expect(dotTone(row)).toBe("neutral")
  })
})

describe("the fleet view's engine dot follows the one verdict", () => {
  function renderFleet() {
    render(
      <TestViewHost tools={TOOLS} client={queryClient}>
        <FleetView engines={engines} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
  }

  it("one open root incident is warning, the threshold danger; the counts stay in the row", async () => {
    renderFleet()
    await waitFor(() => expect(dotTone(fleetRow("one-incident"))).toBe("warning"))
    await waitFor(() => expect(dotTone(fleetRow("at-threshold"))).toBe("danger"))
    expect(within(fleetRow("at-threshold")).getByText("50")).toBeTruthy()
  })

  it("is one row per engine and no card: the row opens its engine", async () => {
    const entered: string[] = []
    render(
      <TestViewHost tools={TOOLS} client={queryClient}>
        <FleetView engines={engines} onEnterEngine={(id) => entered.push(id)} />
      </TestViewHost>,
    )
    await waitFor(() => expect(dotTone(fleetRow("steady"))).toBe("neutral"))
    expect(screen.queryByRole("heading", { name: "Engine health" })).toBeNull()
    expect(screen.queryByText("Open")).toBeNull()
    fleetRow("steady").click()
    expect(entered).toEqual(["steady"])
    // The id in the landing's sans, never mono.
    expect(within(fleetRow("steady")).getByText("steady").className).not.toContain("font-mono")
  })

  it("jobs without retries keep their alarm on the count but do not colour the dot", async () => {
    renderFleet()
    await waitFor(() => expect(healthQueryDone("stuck-jobs")).toBe(true))
    expect(dotTone(fleetRow("stuck-jobs"))).toBe("neutral")
    // A neutral number with the danger tone's icon and words (invariant 6).
    const count = within(fleetRow("stuck-jobs"))
      .getByText("4")
      .closest('[data-slot="count-figure"]')!
    expect(count.getAttribute("data-tone")).toBe("danger")
    expect(count.textContent).toBe("4Has jobs without retries")
  })

  it("an idle engine stays neutral", async () => {
    renderFleet()
    await waitFor(() => expect(healthQueryDone("idle")).toBe(true))
    expect(dotTone(fleetRow("idle"))).toBe("neutral")
  })

  it("an unreachable engine's row has no quiet dot: the outage's icon in danger, as on the landing", async () => {
    const down = () => {
      throw new Error("engine down unreachable (ECONNREFUSED)")
    }
    render(
      <TestViewHost
        tools={{ [ENGINE_COCKPIT_OVERVIEW_DATA]: down, [ENGINE_HEALTH_DATA]: down }}
        client={queryClient}
      >
        <FleetView engines={[{ id: "down" }, { id: "also-down" }]} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    await waitFor(() => expect(fleetRow("down").textContent).toContain("unreachable"))
    const row = fleetRow("down")
    expect(row.querySelector("[data-part='verdict']")).toBeNull()
    const mark = row.querySelector("svg")?.getAttribute("class") ?? ""
    expect(mark).toContain("lucide-unplug")
    expect(mark).toContain(TONE_ICON.danger)
  })
})

function healthQuery(engineId: string) {
  return queryClient.getQueryCache().find({ queryKey: ["engine:health", engineId], exact: false })
}
const healthQueryDone = (engineId: string) => healthQuery(engineId)?.state.status === "success"
const healthQueryFailed = (engineId: string) => healthQuery(engineId)?.state.status === "error"
