// @vitest-environment happy-dom
/**
 * An engine whose processes hold no open root incident while its verdict judged some outside any
 * process (a batch's or the history cleanup's failed job) on the landing and in the cross-engine
 * view (owner decision of 2026-11-26): the row names them beside the warning dot they make, a
 * lower bound where the server's scan stopped, never "no incidents".
 */
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_COCKPIT_OVERVIEW_DATA, ENGINE_HEALTH_DATA } from "../../tool-names.js"
import type { CockpitDashboardData } from "../../view-models.js"
import { HEALTHY } from "../engine-health.test-support.js"
import { engineRowKind } from "./engine-row-status.js"
import { FleetView } from "./fleet-view.js"
import { LandingChooser } from "./landing.js"

afterEach(cleanup)

/** What each engine holds: its processes' open root incidents and failed jobs, those outside. */
const ENGINES: Record<string, { incidents: number; failedJobs: number; outside?: number }> = {
  batch: { incidents: 0, failedJobs: 0, outside: 1 },
  "batch-cut": { incidents: 0, failedJobs: 0, outside: 2000 },
  "batch-stuck": { incidents: 0, failedJobs: 4, outside: 3 },
  both: { incidents: 18, failedJobs: 0, outside: 2 },
  steady: { incidents: 0, failedJobs: 0, outside: 0 },
  // A server before the count: its health feed carries none.
  before: { incidents: 0, failedJobs: 0 },
}

const of = (args: Record<string, unknown>) => ENGINES[String(args.engine)]

function overviewFeed(args: Record<string, unknown>): CockpitDashboardData {
  const e = of(args)
  return {
    summary: {
      totalDefinitions: 1,
      totalRunningInstances: 10,
      totalFailedJobs: e.failedJobs,
      totalIncidents: e.incidents,
    },
    definitions: [],
    engineId: String(args.engine),
  }
}

function healthFeed(args: Record<string, unknown>) {
  const { incidents, outside } = of(args)
  const summary = { ...HEALTHY.summary, totalIncidents: incidents }
  delete summary.outsideAnyProcess
  return {
    ...HEALTHY,
    status: incidents + (outside ?? 0) > 0 ? "warning" : "ok",
    summary:
      outside === undefined
        ? summary
        : { ...summary, outsideAnyProcess: { count: outside, atLeast: outside === 2000 } },
    engineId: String(args.engine),
  }
}

const TOOLS = { [ENGINE_COCKPIT_OVERVIEW_DATA]: overviewFeed, [ENGINE_HEALTH_DATA]: healthFeed }

function renderLanding(locale = "en") {
  render(
    <TestViewHost tools={TOOLS} client={createTestQueryClient()} locale={locale}>
      <LandingChooser
        engines={Object.keys(ENGINES).map((id) => ({ id }))}
        onEnterEngine={() => {}}
      />
    </TestViewHost>,
  )
}

const row = (engine: string, words: string) =>
  screen.findByRole("button", { name: new RegExp(`^${engine}\\s*,\\s*${words}$`) })

describe("the landing's row of an engine with incidents outside any process", () => {
  it("names them beside the dot, never no incidents; a lower bound where the scan stopped", async () => {
    renderLanding()
    expect((await row("batch", "1 incident outside any process")).dataset.status).toBe("outside")
    await row("batch-cut", "≥\\s2,000 incidents outside any process")
    // They are incidents: before the jobs without retries, after the processes' own.
    await row("batch-stuck", "3 incidents outside any process")
    await row("both", "18 incidents")
    await row("steady", "no incidents")
    await row("before", "no incidents")
  })

  it("words them in German", async () => {
    renderLanding("de")
    await row("batch", "1 Incident außerhalb von Prozessen")
    await row("batch-cut", "≥\\s2\\.000 Incidents außerhalb von Prozessen")
  })
})

describe("the cross-engine view's row of an engine with incidents outside any process", () => {
  it("names them beside its id, its figures the processes' own", async () => {
    render(
      <TestViewHost tools={TOOLS} client={createTestQueryClient()}>
        <FleetView engines={["batch", "steady"].map((id) => ({ id }))} onEnterEngine={() => {}} />
      </TestViewHost>,
    )
    const words = await screen.findByText("1 incident outside any process")
    expect(within(words.closest("tr")!).getByText("batch")).toBeTruthy()
    expect(document.querySelectorAll('[data-part="engine-outside"]')).toHaveLength(1)
  })
})

describe("engineRowKind", () => {
  const health = (outside: number | undefined, kind: Partial<CockpitDashboardData["summary"]>) =>
    ({
      failure: null,
      status: "warning",
      summary: {
        totalDefinitions: 1,
        totalRunningInstances: 0,
        totalFailedJobs: 0,
        totalIncidents: 0,
        ...kind,
      },
      outside: outside === undefined ? undefined : { count: outside, atLeast: false },
    }) as unknown as Parameters<typeof engineRowKind>[0]

  it("takes the place of a quiet state alone, never of the processes' incidents", () => {
    expect(engineRowKind(health(1, {}))).toBe("outside")
    expect(engineRowKind(health(1, { totalRunningInstances: 3 }))).toBe("outside")
    expect(engineRowKind(health(1, { totalFailedJobs: 2 }))).toBe("outside")
    expect(engineRowKind(health(1, { totalIncidents: 5 }))).toBe("incidents")
    expect(engineRowKind(health(0, {}))).toBe("idle")
    expect(engineRowKind(health(undefined, { totalRunningInstances: 3 }))).toBe("healthy")
  })
})
