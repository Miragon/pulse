// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { cleanup, screen, within } from "@testing-library/react"
import type { EngineLandscapeResult, FailureDashboardData } from "@miragon/pulse-analytics-client"
import { FailureSummaryKpi } from "./failure-dashboard/summary-kpi.js"
import { ErrorPatternsTable } from "./failure-dashboard/error-patterns-table.js"
import { FailureRateTable, rateBarWidth } from "./failure-dashboard/failure-rate-table.js"
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

const FAILURES: Named<FailureDashboardData> = {
  engines: ["prod-a"],
  totalIncidents: 1234,
  uniqueErrorPatterns: 2,
  mostAffectedProcess: "order",
  errorPatterns: [
    { incidentType: "failedJob", processDefinitionKey: "order", incidentCount: 1200 },
    { incidentType: "failedExternalTask", processDefinitionKey: "invoice", incidentCount: 34 },
  ],
  processBreakdown: [
    {
      processDefinitionKey: "order",
      runningNow: 3000,
      deadJobs: 1100,
      openIncidents: 1200,
      incidentRatePct: 40,
    },
    {
      processDefinitionKey: "invoice",
      runningNow: 8,
      deadJobs: 0,
      openIncidents: 34,
      incidentRatePct: 425,
    },
  ],
  asOf: AS_OF,
  names: { order: { name: "Order fulfillment", elements: {} } },
}

describe("the failure dashboard", () => {
  it("frames a live snapshot without a period and hands off to prioritize (de)", () => {
    renderIn("de", FailureSummaryKpi, FAILURES)
    expect(metaLine()).toBe("1 Engine · Stand 14:32")
    expect(screen.getByText("1.234")).toBeTruthy()
    expect(screen.getByText("Incident-Gruppen")).toBeTruthy()
    const ask = screen.getByRole("button", { name: /Im Chat priorisieren/ })
    expect(iconOf(ask)).toContain("lucide-list-ordered")
  })

  // U14: the tiles are no status board; only open incidents are a state.
  it("shows the summary as the neutral strip, open incidents as the one state", () => {
    const { container } = renderIn("de", FailureSummaryKpi, FAILURES)
    expect(kpiTone("Offene Incidents")).toBe("danger")
    expect(kpiTone("Incident-Gruppen")).toBeUndefined()
    expect(kpiTone("Am stärksten betroffen")).toBeUndefined()
    expect(container.querySelector("[class*='-soft']")).toBeNull()
    expect(screen.getByText("Order fulfillment")).toBeTruthy()
    expect(screen.getByText("order").className).toContain("font-mono")
  })

  it("marks no state when nothing is open, and names no process as affected", () => {
    renderIn("en", FailureSummaryKpi, {
      ...FAILURES,
      totalIncidents: 0,
      uniqueErrorPatterns: 0,
      mostAffectedProcess: null,
    })
    expect(kpiTone("Open incidents")).toBeUndefined()
    // Known to be none, so words, quiet: "—" is kept for a figure nobody measured (U17).
    const none = screen.getByText("No process")
    expect(none.className).toContain("text-muted-foreground")
    expect(kpiTone("Most affected")).toBeUndefined()
    expect(screen.queryByText("—")).toBeNull()
    cleanup()
    renderIn("de", FailureSummaryKpi, { ...FAILURES, totalIncidents: 0, mostAffectedProcess: null })
    expect(screen.getByText("Kein Prozess")).toBeTruthy()
  })

  it("shows an unnamed most affected process by its key in mono", () => {
    renderIn("en", FailureSummaryKpi, { ...FAILURES, mostAffectedProcess: "invoice" })
    expect(screen.getByText("invoice").className).toContain("font-mono")
  })

  it("finds the cause of an incident group in the chat (en)", () => {
    renderIn("en", ErrorPatternsTable, FAILURES)
    expect(screen.getByText("1,200")).toBeTruthy()
    expect(
      screen.getByRole("region", { name: "Open incidents by incident type and process" }),
    ).toBeTruthy()
    expect(screen.getByText("Order fulfillment")).toBeTruthy()
    const asks = screen.getAllByRole("button", { name: "Find cause in chat" })
    expect(asks).toHaveLength(2)
    expect(iconOf(asks[0])).toContain("lucide-scan-search")
  })

  it("says all clear when no incident is open (de)", () => {
    const { container } = renderIn("de", ErrorPatternsTable, {
      ...FAILURES,
      errorPatterns: [],
      processBreakdown: [],
    })
    expect(screen.getByText("Keine offenen Incidents")).toBeTruthy()
    expect(container.querySelector("[data-empty-variant='done']")).not.toBeNull()
  })

  it("names the jobs without retries and a rate over 100 as a number (de)", () => {
    renderIn("de", FailureRateTable, FAILURES)
    expect(screen.getByText("Jobs ohne Versuche")).toBeTruthy()
    expect(screen.getByText("Incidents je 100 laufende Instanzen")).toBeTruthy()
    expect(screen.getByText("425")).toBeTruthy()
    expect(screen.getByText("3.000")).toBeTruthy()
    const asks = screen.getAllByRole("button", { name: "Ursache im Chat klären" })
    expect(asks).toHaveLength(2)
    expect(iconOf(asks[0])).toContain("lucide-scan-search")
  })

  // U17: a rate may pass 100 — the bars scale to the table's largest, never cut at 100.
  it("scales the rate bars to the largest rate in the table", () => {
    const { container } = renderIn("de", FailureRateTable, FAILURES)
    const bars = [...container.querySelectorAll<HTMLElement>("[style*='width']")]
    expect(bars.map((el) => el.style.width)).toEqual([`${(40 / 425) * 100}%`, "100%"])
    expect(rateBarWidth(0, 10)).toBe(0)
    expect(rateBarWidth(5, 0)).toBe(0)
    expect(rateBarWidth(20, 10)).toBe(100)
  })

  // U17, decision j: a rate without a threshold or a period before is a magnitude.
  it("draws the rate bars in the data-viz blue, the open incidents with the danger edge", () => {
    const { container } = renderIn("de", FailureRateTable, FAILURES)
    for (const bar of container.querySelectorAll<HTMLElement>("[style*='width']")) {
      expect(bar.className).toContain("bg-info")
      expect(bar.className).not.toContain("danger")
    }
    const open = screen.getByText("1.200")
    expect(open.className).toContain("border-danger")
    expect(open.className).not.toMatch(/text-danger/)
  })

  // Decision f: one ladder (`countTone`) in every module, as camunda7 edges the same count.
  it("edges the dead jobs and open incidents in danger while there are any, a zero plain", () => {
    renderIn("de", FailureRateTable, {
      ...FAILURES,
      processBreakdown: [
        FAILURES.processBreakdown[0],
        { ...FAILURES.processBreakdown[1], openIncidents: 0 },
      ],
    })
    const table = screen.getByRole("table")
    const order = within(table).getByText("Order fulfillment").closest("tr")!
    expect(within(order).getByText("1.100").className).toContain("border-danger")
    expect(within(order).getByText("1.200").className).toContain("border-danger")
    const invoice = within(table).getByText("invoice").closest("tr")!
    const zeros = within(invoice).getAllByText("0")
    expect(zeros).toHaveLength(2)
    for (const zero of zeros) expect(zero.className).not.toContain("border-danger")
  })

  it("explains a rate over no running instance instead of showing a bare dash (en)", () => {
    renderIn("en", FailureRateTable, {
      ...FAILURES,
      processBreakdown: [{ ...FAILURES.processBreakdown[0], runningNow: 0, incidentRatePct: null }],
    })
    expect(missingFigures(document.body)).toEqual([
      missing("No running instance reported: no rate"),
    ])
    expect(legendLines()).toEqual(["— No running instance reported: no rate"])
  })

  it("shows no key under the rate table while every rate is measured", () => {
    renderIn("en", FailureRateTable, FAILURES)
    expect(legendLines()).toEqual([])
  })
})

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
