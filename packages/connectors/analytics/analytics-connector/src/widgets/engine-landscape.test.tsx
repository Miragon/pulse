// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import type { EngineLandscapeResult } from "@miragon/pulse-analytics-client"
import { EngineLandscapeWidget } from "./engine-landscape.js"
import type { Named } from "../bpmn-names.js"
import {
  AS_OF,
  groupHeads,
  headers,
  iconOf,
  kpiTone,
  legendLines,
  metaLine,
  missing,
  missingFigures,
  renderIn,
  withWidgetClock,
} from "./widget-render.test-support.js"

withWidgetClock()

const LANDSCAPE: Named<EngineLandscapeResult> = {
  engines: [
    {
      engineId: "prod-a",
      reporting: true,
      runningInstances: 1500,
      openIncidents: 3,
      failedJobs: 0,
      executableJobs: 12,
      suspendedJobs: 0,
      jobsDueFuture: 4,
      openExternalTasks: 2,
      deployedDefinitionKeys: 2,
      exclusiveDefinitionKeys: 1,
    },
    {
      engineId: "prod-b",
      reporting: true,
      runningInstances: 7,
      openIncidents: 0,
      failedJobs: 0,
      executableJobs: 1,
      suspendedJobs: 0,
      jobsDueFuture: 0,
      openExternalTasks: 0,
      deployedDefinitionKeys: 1,
      exclusiveDefinitionKeys: 0,
    },
    {
      engineId: "prod-c",
      reporting: false,
      runningInstances: null,
      openIncidents: null,
      failedJobs: null,
      executableJobs: null,
      suspendedJobs: null,
      jobsDueFuture: null,
      openExternalTasks: null,
      deployedDefinitionKeys: null,
      exclusiveDefinitionKeys: null,
    },
  ],
  processes: [
    {
      processDefinitionKey: "order",
      engineIds: ["prod-a", "prod-b"],
      shared: true,
      runningByEngine: { "prod-a": 1500, "prod-b": 7 },
      runningTotal: 1507,
      openIncidentsTotal: 3,
      failedJobsTotal: 0,
    },
    {
      processDefinitionKey: "invoice",
      engineIds: ["prod-a"],
      shared: false,
      runningByEngine: {},
      runningTotal: 0,
      openIncidentsTotal: 0,
      failedJobsTotal: 0,
    },
  ],
  sharedProcessKeys: ["order"],
  totals: {
    engineCount: 3,
    reportingEngineCount: 2,
    processKeyCount: 2,
    sharedProcessKeyCount: 1,
    runningInstances: 1507,
    openIncidents: 3,
    failedJobs: 0,
  },
  asOf: AS_OF,
  names: { order: { name: "Order fulfillment", elements: {} } },
}

describe("the cross-engine landscape", () => {
  it("frames the snapshot and compares a shared process across engines in the chat (de)", () => {
    renderIn("de", EngineLandscapeWidget, LANDSCAPE)
    expect(metaLine()).toBe("3 Engines (1 ohne Metriken) · Stand 14:32")
    expect(screen.getByText("Was wo läuft. Keine Rangliste der Engines.")).toBeTruthy()
    expect(screen.getAllByText("1.500").length).toBeGreaterThan(0)
    expect(screen.getByText("auf 2 Engines")).toBeTruthy()
    const ask = screen.getByRole("button", {
      name: "„order“ im Chat zwischen seinen Engines vergleichen",
    })
    expect(iconOf(ask)).toContain("lucide-arrow-left-right")
  })

  it("heads the per-engine table's two column groups", () => {
    renderIn("de", EngineLandscapeWidget, LANDSCAPE)
    const table = screen.getByRole("table", { name: "Last und Job-Rückstand je Engine" })
    expect(groupHeads(table)).toEqual([
      ["Last (absolut)", "3"],
      ["Job-Rückstand, über Engines vergleichbar", "4"],
    ])
  })

  // Decision f: an engine's open incidents are a state, edged like the matrix's.
  it("edges an engine's open incidents in danger and leaves its other counts plain", () => {
    renderIn("de", EngineLandscapeWidget, LANDSCAPE)
    const table = screen.getByRole("table", { name: "Last und Job-Rückstand je Engine" })
    const busy = within(table).getByText("prod-a").closest("tr")!
    expect(within(busy).getByText("3").className).toContain("border-danger")
    expect(busy.querySelectorAll("[class*='border-danger']")).toHaveLength(1)
    const calm = within(table).getByText("prod-b").closest("tr")!
    expect(calm.querySelector("[class*='border-danger']")).toBeNull()
  })

  // Decision f: as camunda7's engine tiles above this table edge them.
  it("edges an engine's jobs without retries in danger, like its open incidents", () => {
    renderIn("de", EngineLandscapeWidget, {
      ...LANDSCAPE,
      engines: [{ ...LANDSCAPE.engines[0], failedJobs: 5 }, ...LANDSCAPE.engines.slice(1)],
    })
    const table = screen.getByRole("table", { name: "Last und Job-Rückstand je Engine" })
    const busy = within(table).getByText("prod-a").closest("tr")!
    expect(within(busy).getByText("5").className).toContain("border-danger")
    expect(busy.querySelectorAll("[class*='border-danger']")).toHaveLength(2)
  })

  // U17: a silent engine is unknown, never a row of plausible zeros.
  it("shows a silent engine's figures as unknown, explained, and its badge as a warning", () => {
    renderIn("en", EngineLandscapeWidget, LANDSCAPE)
    const row = screen.getByText("prod-c").closest("tr")!
    expect(within(row).queryByText("0")).toBeNull()
    expect(missingFigures(row)).toEqual(
      Array(8).fill(missing("No metrics from this engine: figure unknown")),
    )
    const badge = within(row).getByText("no metrics").closest("[data-slot='status-badge']")!
    expect(badge.getAttribute("data-tone")).toBe("warning")
    // One line in its pill, whatever the column width: never "no / metrics".
    expect(badge.className).toContain("whitespace-nowrap")
    // The silent engine has no column in the matrix; a note names it, in the singular.
    const matrix = screen.getByRole("table", { name: "Process definitions by engine" })
    expect(headers(matrix)).not.toContain("prod-c")
    expect(legendLines()).toEqual([
      "— No metrics from this engine: figure unknown",
      "An empty cell means the process is not deployed on that engine.",
      "No column for prod-c: this engine sends no metrics.",
    ])
  })

  it("names several silent engines in the plural (de)", () => {
    const silent = LANDSCAPE.engines[2]
    renderIn("de", EngineLandscapeWidget, {
      ...LANDSCAPE,
      engines: [...LANDSCAPE.engines, { ...silent, engineId: "prod-d" }],
    })
    expect(
      screen.getByText("Keine Spalten für prod-c, prod-d: Diese Engines melden keine Metriken."),
    ).toBeTruthy()
    cleanup()
    renderIn("de", EngineLandscapeWidget, LANDSCAPE)
    expect(
      screen.getByText("Keine Spalte für prod-c: Diese Engine meldet keine Metriken."),
    ).toBeTruthy()
  })

  it("marks a process that is not deployed on an engine as an empty cell, not as unknown", () => {
    renderIn("en", EngineLandscapeWidget, LANDSCAPE)
    const row = screen.getByText("invoice").closest("tr")!
    expect(within(row).queryByText("—")).toBeNull()
    expect(within(row).getByText("not deployed on this engine").className).toContain("sr-only")
    expect(
      screen.getByText("An empty cell means the process is not deployed on that engine."),
    ).toBeTruthy()
    expect(screen.getByText("Order fulfillment")).toBeTruthy()
  })

  it("leaves the totals unknown while no engine reports", () => {
    renderIn("en", EngineLandscapeWidget, {
      ...LANDSCAPE,
      engines: [LANDSCAPE.engines[2]],
      processes: [],
      sharedProcessKeys: [],
      totals: {
        engineCount: 1,
        reportingEngineCount: 0,
        processKeyCount: 0,
        sharedProcessKeyCount: 0,
        runningInstances: null,
        openIncidents: null,
        failedJobs: null,
      },
    })
    expect(kpiTone("Open incidents")).toBeUndefined()
    const running = screen.getByText("Running instances").closest("div")!.parentElement!
    expect(running.textContent).toContain("—")
  })
})

// U1: the module's own title heads only a failure the kit cannot classify.
describe("the landscape's self-fetch (the fleet view)", () => {
  const FEED = "analytics_engine_landscape_data"

  function renderFailing(message: string) {
    const feed = vi.fn(() => {
      throw new Error(message)
    })
    renderIn("de", EngineLandscapeWidget, null, { [FEED]: feed })
    return feed
  }

  it("says Prometheus is unreachable and what to do, and retries the query", async () => {
    const feed = renderFailing("Prometheus unreachable (ECONNREFUSED)")
    expect(
      await screen.findByRole("heading", { name: "Prometheus ist nicht erreichbar" }),
    ).toBeTruthy()
    expect(screen.getByText("Prüf, ob Prometheus läuft und erreichbar ist.")).toBeTruthy()
    expect(feed).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }))
    await waitFor(() => expect(feed).toHaveBeenCalledTimes(2))
  })

  it("heads a failure the kit cannot classify with the module's own words", async () => {
    renderFailing("odd")
    expect(
      await screen.findByRole("heading", { name: "Die Kennzahlen konnten nicht geladen werden." }),
    ).toBeTruthy()
  })

  it("renders the landscape once the feed answers", async () => {
    renderIn("en", EngineLandscapeWidget, null, { [FEED]: LANDSCAPE })
    expect(await screen.findByText("Order fulfillment")).toBeTruthy()
    expect(metaLine()).toBe("3 engines (1 without metrics) · As of 14:32")
  })
})
