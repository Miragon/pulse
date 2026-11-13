// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import { DEFAULT_VERDICT_THRESHOLDS, engineVerdict } from "@miragon/pulse-c7-core"
import { SITUATION_TONES, TONE_DOT, type ToneVariant } from "@miragon/pulse-ui"
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
  openIncidents: number
  largestCause: number
  failedJobs: number
  running: number
}

const ENGINES: Record<string, EngineCounts> = {
  "one-incident": { openIncidents: 1, largestCause: 1, failedJobs: 0, running: 10 },
  "at-threshold": {
    openIncidents: DEFAULT_VERDICT_THRESHOLDS.criticalIncidents,
    largestCause: 3,
    failedJobs: 0,
    running: 10,
  },
  "stuck-jobs": { openIncidents: 0, largestCause: 0, failedJobs: 4, running: 10 },
  steady: { openIncidents: 0, largestCause: 0, failedJobs: 0, running: 10 },
  idle: { openIncidents: 0, largestCause: 0, failedJobs: 0, running: 0 },
}

const countsOf = (args: Record<string, unknown>) => ENGINES[String(args.engine)]

function overviewFeed(args: Record<string, unknown>): CockpitDashboardData {
  const e = countsOf(args)
  return {
    summary: {
      totalDefinitions: 2,
      totalRunningInstances: e.running,
      totalFailedJobs: e.failedJobs,
      totalIncidents: e.openIncidents,
    },
    definitions: [],
    engineId: String(args.engine),
  }
}

/** The verdict as the health feed's builder computes it: c7-core's, on the default thresholds. */
function healthFeed(args: Record<string, unknown>): EngineHealthData {
  const e = countsOf(args)
  return {
    status: engineVerdict(
      { openIncidents: e.openIncidents, largestCluster: e.largestCause },
      DEFAULT_VERDICT_THRESHOLDS,
    ),
    statusRule: "",
    summary: {
      totalIncidents: e.openIncidents,
      lastHourIncidents: 0,
      last24hIncidents: 0,
      affectedActivities: null,
      affectedDefinitions: 0,
      runningInstances: e.running,
      totalDefinitions: 2,
      started24h: null,
      completed24h: null,
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
  const dot = container.querySelector(".size-2.rounded-full")
  return TONES.find((tone) => dot?.classList.contains(TONE_DOT[tone]))
}

async function landingRow(engineId: string): Promise<HTMLElement> {
  return screen.findByRole("button", { name: new RegExp(`^${engineId}\\s*,`) })
}

/** The engine's card: the landscape below names the engine too, but in no button. */
function fleetCard(engineId: string): HTMLElement {
  const cards = screen
    .getAllByText(engineId, { selector: "span" })
    .flatMap((name) => name.closest("button") ?? [])
  expect(cards).toHaveLength(1)
  return cards[0]
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

  it("one open incident, no threshold reached: warning, as the overview badge says", async () => {
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

  it("one open incident is warning, the threshold danger; the counts stay on the card", async () => {
    renderFleet()
    await waitFor(() => expect(dotTone(fleetCard("one-incident"))).toBe("warning"))
    await waitFor(() => expect(dotTone(fleetCard("at-threshold"))).toBe("danger"))
    expect(within(fleetCard("at-threshold")).getByText("50")).toBeTruthy()
  })

  it("jobs without retries keep their alarm on the count but do not colour the dot", async () => {
    renderFleet()
    await waitFor(() => expect(healthQueryDone("stuck-jobs")).toBe(true))
    expect(dotTone(fleetCard("stuck-jobs"))).toBe("neutral")
    // A neutral number with the danger tone's icon and words (invariant 6).
    const count = within(fleetCard("stuck-jobs"))
      .getByText("4")
      .closest('[data-slot="count-figure"]')!
    expect(count.getAttribute("data-tone")).toBe("danger")
    expect(count.textContent).toBe("4Has jobs without retries")
  })

  it("an idle engine stays neutral", async () => {
    renderFleet()
    await waitFor(() => expect(healthQueryDone("idle")).toBe(true))
    expect(dotTone(fleetCard("idle"))).toBe("neutral")
  })
})

function healthQuery(engineId: string) {
  return queryClient.getQueryCache().find({ queryKey: ["engine:health", engineId], exact: false })
}
const healthQueryDone = (engineId: string) => healthQuery(engineId)?.state.status === "success"
const healthQueryFailed = (engineId: string) => healthQuery(engineId)?.state.status === "error"
