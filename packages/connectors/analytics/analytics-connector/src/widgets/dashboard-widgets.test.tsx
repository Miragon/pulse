// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import { cleanup, screen, within } from "@testing-library/react"
import type { AnalyticsDashboardData } from "@miragon/pulse-analytics-client"
import { ExecutionSummaryKpi } from "./analytics-dashboard/execution-summary-kpi.js"
import { ExecutionPerformanceKpi } from "./analytics-dashboard/execution-performance-kpi.js"
import { ProcessDefinitionBreakdown } from "./analytics-dashboard/definition-breakdown.js"
import { ActivityBottleneckTable } from "./analytics-dashboard/activity-bottleneck-table.js"
import { AnalyticsBpmnHeatmap, type AnalyticsBpmnHeatmapData } from "./bpmn-heatmap.js"
import type { Named } from "../bpmn-names.js"
import {
  AS_OF,
  headers,
  iconOf,
  kpiTone,
  legendLines,
  metaLine,
  missing,
  missingFigures,
  plain,
  renderIn,
  withWidgetClock,
} from "./widget-render.test-support.js"

/** The failure dashboard and the landscape: `failure-landscape-widgets.test.tsx`. */

withWidgetClock()

const DASHBOARD: Named<AnalyticsDashboardData> = {
  processDefinitionKey: null,
  period: "7d",
  engines: ["prod-a", "prod-b", "prod-c"],
  reportingEngines: ["prod-a", "prod-c"],
  asOf: AS_OF,
  totalCount: 1629,
  completedCount: 1482,
  incidentsCreated: 55,
  incidentsResolved: 34,
  incidentRatePct: 3.38,
  avgDurationMs: 30_840_000,
  medianDurationMs: 24_600_000,
  p95DurationMs: 73_860_000,
  runningNow: 52,
  openIncidentsNow: null,
  previous: null,
  activityBreakdown: [
    {
      processDefinitionKey: "miraveloLeasing",
      activityId: "Activity_DecideOnApplication",
      activityType: "userTask",
      executionCount: 1240,
      avgDurationMs: 187_000,
      p95DurationMs: 420_000,
      totalTimeMs: 231_880_000,
    },
    {
      processDefinitionKey: "invoice",
      activityId: "Event_Paid",
      activityType: "noneEndEvent",
      executionCount: 300,
      avgDurationMs: 0,
      p95DurationMs: null,
      totalTimeMs: 0,
    },
  ],
  activityCount: 2,
  definitionBreakdown: [
    {
      processDefinitionKey: "miraveloLeasing",
      totalInstances: 1288,
      completed: 1262,
      runningNow: 1,
      incidentsCreated: 1,
      avgDurationMs: 8_340_000,
    },
    {
      processDefinitionKey: "invoice",
      totalInstances: 341,
      completed: 220,
      runningNow: null,
      incidentsCreated: 0,
      avgDurationMs: null,
    },
  ],
  names: {
    miraveloLeasing: {
      name: "Bike Leasing",
      elements: { Activity_DecideOnApplication: "Decide on application" },
    },
  },
}

describe("the analytics dashboard in German", () => {
  it("frames the figures under the title and hands off to the chat to assess them", () => {
    renderIn("de", ExecutionSummaryKpi, DASHBOARD)
    expect(screen.getByText("Prozessanalyse")).toBeTruthy()
    expect(metaLine()).toBe("Letzte 7 Tage · 3 Engines (1 ohne Metriken) · Stand 14:32")
    expect(screen.getByText("1.629")).toBeTruthy()
    expect(screen.getByText("Neue Incidents")).toBeTruthy()
    // A live gauge nobody reports is unknown, never a plausible 0.
    expect(screen.getByText("—")).toBeTruthy()
    const ask = screen.getByRole("button", { name: /Im Chat bewerten/ })
    expect(iconOf(ask)).toContain("lucide-list-checks")
  })

  it("names the process a scoped dashboard is about first, by its name when known", () => {
    renderIn("de", ExecutionSummaryKpi, {
      ...DASHBOARD,
      processDefinitionKey: "order",
      period: "1d",
    })
    expect(metaLine()).toBe("order · Letzte 24 Stunden · 3 Engines (1 ohne Metriken) · Stand 14:32")
    cleanup()
    renderIn("de", ExecutionSummaryKpi, { ...DASHBOARD, processDefinitionKey: "miraveloLeasing" })
    expect(metaLine()).toMatch(/^Bike Leasing · Letzte 7 Tage/)
  })

  // U14: counts of what happened carry no state; only an open incident does.
  it("keeps every count neutral and marks only open incidents", () => {
    renderIn("de", ExecutionSummaryKpi, { ...DASHBOARD, openIncidentsNow: 21 })
    for (const label of ["Gestartet", "Abgeschlossen", "Neue Incidents", "Laufen gerade"]) {
      expect(kpiTone(label), label).toBeUndefined()
    }
    expect(kpiTone("Offene Incidents jetzt")).toBe("danger")
    expect(document.querySelector("[class*='text-success'], [class*='text-info']")).toBeNull()
  })

  it("shows an incident rate as incidents per 100 starts, not as a share", () => {
    renderIn("de", ExecutionPerformanceKpi, DASHBOARD)
    expect(screen.getByText("Incidents je 100 Starts")).toBeTruthy()
    expect(screen.getByText("3,4")).toBeTruthy()
    expect(plain(screen.getByText(/^8 h/).textContent)).toBe("8 h 34 Min.")
    // No previous period (a 30-day view): no verdict, no tone.
    expect(kpiTone("Incidents je 100 Starts")).toBeUndefined()
    expect(screen.queryByText(/Vorperiode/)).toBeNull()
  })

  it("judges the incident rate only against the previous period, from its threshold on", () => {
    const previous = {
      totalCount: 1500,
      incidentsCreated: 20,
      incidentRatePct: 1.3,
      partial: false,
      suppressed: false,
    }
    // The process held fixed: the only scope a change of the rate says something about.
    const scoped = { ...DASHBOARD, processDefinitionKey: "miraveloLeasing" }
    renderIn("de", ExecutionPerformanceKpi, { ...scoped, previous })
    const worse = screen.getByText("Vorperiode: 1,3, schlechter")
    expect(iconOf(worse.parentElement!)).toContain("lucide-trending-up")
    expect(iconOf(worse.parentElement!)).toContain("text-danger")
    // The rate itself stays neutral: the verdict is the trend, never the digit.
    expect(kpiTone("Incidents je 100 Starts")).toBeUndefined()
    cleanup()

    // Below the threshold of 1 per 100 starts: the number, no verdict.
    renderIn("de", ExecutionPerformanceKpi, {
      ...scoped,
      previous: { ...previous, incidentRatePct: 3 },
    })
    const flat = screen.getByText("Vorperiode: 3")
    expect(iconOf(flat.parentElement!)).toContain("lucide-minus")
    expect(iconOf(flat.parentElement!)).not.toMatch(/text-(danger|success)/)
    cleanup()

    // Over too few starts: shown, not judged.
    renderIn("en", ExecutionPerformanceKpi, {
      ...scoped,
      previous: { ...previous, suppressed: true },
    })
    const noisy = screen.getByText("Previous period: 1.3, not reliable")
    expect(iconOf(noisy.parentElement!)).not.toMatch(/text-(danger|success)/)
    cleanup()

    renderIn("en", ExecutionPerformanceKpi, {
      ...scoped,
      previous: { ...previous, totalCount: 0, incidentsCreated: 0, incidentRatePct: null },
    })
    expect(screen.getByText("Previous period: no starts")).toBeTruthy()
  })

  // Simpson's paradox: over several processes the rate moves with their mix,
  // even while no process changed, so its change is no verdict.
  it("names the previous rate of a dashboard over several processes without judging it", () => {
    const previous = {
      totalCount: 1500,
      incidentsCreated: 20,
      incidentRatePct: 1.3,
      partial: false,
      suppressed: false,
    }
    renderIn("de", ExecutionPerformanceKpi, { ...DASHBOARD, previous })
    const reference = screen.getByText("Vorperiode: 1,3")
    const line = reference.parentElement!
    expect(iconOf(line)).toBe("")
    expect(line.querySelector("[class*='bg-danger'], [class*='bg-success']")).toBeNull()
    expect(screen.queryByText(/schlechter|besser/)).toBeNull()
    expect(kpiTone("Incidents je 100 Starts")).toBeUndefined()
  })

  it("lays the breakdown out as a table with right-aligned figures", () => {
    renderIn("de", ProcessDefinitionBreakdown, DASHBOARD)
    const table = screen.getByRole("table", {
      name: "Starts, Abschlüsse, laufende Instanzen und Incidents je Prozess",
    })
    expect(headers(table)).toEqual([
      "Prozess",
      "Gestartet",
      "Abgeschlossen",
      "Laufen gerade",
      "Neue Incidents",
      "Durchschn. Dauer",
    ])
    expect(screen.getByText("Bike Leasing")).toBeTruthy()
    const key = screen.getByText("miraveloLeasing")
    expect(key.className).toContain("font-mono")
    expect(screen.getByText("invoice").className).toContain("font-mono")
    const started = screen.getByText("1.288").closest("td")!
    expect(started.className).toContain("text-right")
    expect(started.className).toContain("tabular-nums")
    // Not measured is "—", never 0, and it says why (U17): read out in its
    // place, as the tooltip, and in the key under the table for everyone.
    const invoiceRow = screen.getByText("invoice").closest("tr")!
    expect(missingFigures(invoiceRow)).toEqual([
      missing("Keine Engine meldet diesen Wert: unbekannt"),
      missing("In diesem Zeitraum ist nichts beendet: keine Dauer"),
    ])
    expect(legendLines()).toEqual([
      "— Keine Engine meldet diesen Wert: unbekannt",
      "— In diesem Zeitraum ist nichts beendet: keine Dauer",
    ])
  })

  it("shows no key under a breakdown without a missing figure", () => {
    renderIn("de", ProcessDefinitionBreakdown, {
      ...DASHBOARD,
      definitionBreakdown: [DASHBOARD.definitionBreakdown[0]],
    })
    expect(missingFigures(document.body)).toEqual([])
    expect(legendLines()).toEqual([])
  })

  // CI §3.3, decisions f and o: new incidents are a volume of the period, as
  // in the summary above, so no count in the breakdown carries a tone.
  it("keeps every count neutral, new incidents included", () => {
    const { container } = renderIn("de", ProcessDefinitionBreakdown, DASHBOARD)
    const leasing = screen.getByText("Bike Leasing").closest("tr")!
    for (const figure of within(leasing).getAllByText("1")) {
      expect(figure.tagName).toBe("TD")
      expect(figure.className).toContain("tabular-nums")
    }
    expect(container.querySelector("[data-tone]")).toBeNull()
    expect(container.querySelector("[class*='-ink']")).toBeNull()
    expect(container.querySelector("[class*='text-success'], [class*='text-danger']")).toBeNull()
  })

  it("names the activities, keeps the sort key next to them and explains a bottleneck in the chat", () => {
    renderIn("de", ActivityBottleneckTable, DASHBOARD)
    expect(screen.getByText("Aktivitäten nach Gesamtzeit")).toBeTruthy()
    const table = screen.getByRole("table", {
      name: "Aktivitäten je Prozess, sortiert nach gesamter Ausführungszeit",
    })
    expect(headers(table).slice(0, 5)).toEqual([
      "Aktivität",
      "Gesamtzeit",
      "Ausführungen",
      "Durchschn.",
      "P95",
    ])
    const total = within(table).getAllByRole("columnheader")[1]
    expect(total.getAttribute("aria-sort")).toBe("descending")
    expect(iconOf(total)).toContain("lucide-arrow-down")
    // Name first; id, type in words and (on a dashboard over several processes) the process below.
    expect(screen.getByText("Decide on application")).toBeTruthy()
    const row = screen.getByText("Decide on application").closest("tr")!
    expect(plain(row.querySelector("td")?.textContent)).toBe(
      "Decide on applicationActivity_DecideOnApplication · User-Task · Bike Leasing",
    )
    // An unknown name: the id leads; the engine's own type name folded into the BPMN element.
    const paid = screen.getByText("Event_Paid").closest("td")!
    expect(plain(paid.textContent)).toBe("Event_PaidEndereignis · invoice")
    // A P95 over nothing that ended: "—" with its reason, never 0 ms, and
    // the key under the table says it to readers who cannot hover.
    expect(missingFigures(paid.closest("tr")!)).toEqual([
      missing("In diesem Zeitraum ist nichts beendet: keine Dauer"),
    ])
    expect(legendLines()).toEqual(["— In diesem Zeitraum ist nichts beendet: keine Dauer"])
    expect(screen.getByText("1.240")).toBeTruthy()
    const ask = screen.getAllByRole("button", { name: "Engpass im Chat erklären" })[0]
    expect(iconOf(ask)).toContain("lucide-hourglass")
  })

  it("calls a cut list what it is: the top by total time, of how many", () => {
    renderIn("de", ActivityBottleneckTable, { ...DASHBOARD, activityCount: 37 })
    expect(screen.getByText("Top 2 nach Gesamtzeit")).toBeTruthy()
    expect(screen.getByText("Die 2 Aktivitäten mit der meisten Gesamtzeit, von 37.")).toBeTruthy()
  })

  it("drops the process from the second line of a dashboard about one process", () => {
    renderIn("en", ActivityBottleneckTable, {
      ...DASHBOARD,
      processDefinitionKey: "miraveloLeasing",
    })
    const row = screen.getByText("Decide on application").closest("td")!
    expect(plain(row.textContent)).toBe(
      "Decide on applicationActivity_DecideOnApplication · User task",
    )
  })

  it("says what to do when nothing ended, in a quiet empty state", () => {
    renderIn("de", ActivityBottleneckTable, {
      ...DASHBOARD,
      activityBreakdown: [],
      activityCount: 0,
    })
    expect(screen.getByText("In diesem Zeitraum hat keine Aktivität geendet")).toBeTruthy()
    expect(
      screen.getByText("Wähl einen längeren Zeitraum oder prüf, ob die Engines Metriken melden."),
    ).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })
})

describe("the analytics dashboard in English", () => {
  it("frames the figures and keeps sentence case", () => {
    renderIn("en", ExecutionSummaryKpi, { ...DASHBOARD, reportingEngines: undefined })
    // Without the reporting engines the line says nothing about them.
    expect(metaLine()).toBe("Last 7 days · 3 engines · As of 14:32")
    expect(screen.getByText("1,629")).toBeTruthy()
    expect(screen.getByText("Process analytics")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Assess in chat/ })).toBeTruthy()
  })
})

const HEATMAP: AnalyticsBpmnHeatmapData = {
  processDefinitionKey: "order",
  period: "14d",
  engines: ["prod-a", "prod-b"],
  frequency: { Task_A: 12 },
  durationSec: { Task_A: 3.5 },
  asOf: AS_OF,
}

/** The heatmap's diagram feed: the view reads the XML from it, never from its payload. */
const diagram = (bpmnXml: string | null) => ({ analytics_bpmn_xml_data: { bpmnXml } })

describe("the BPMN heatmap", () => {
  it("states period, engines and as-of in place of the period badge (de)", async () => {
    renderIn("de", AnalyticsBpmnHeatmap, HEATMAP, diagram('<?xml version="1.0"?><definitions />'))
    expect(await screen.findByText("BPMN-Heatmap")).toBeTruthy()
    expect(metaLine()).toBe("Letzte 14 Tage · 2 Engines · Stand 14:32")
    expect(screen.queryByText(/Zeitraum:/)).toBeNull()
  })

  it("blames the missing camunda7 module only when the server says so (en)", () => {
    renderIn("en", AnalyticsBpmnHeatmap, { ...HEATMAP, bpmnMissing: "no-camunda7" })
    expect(
      screen.getByText(
        "The diagram is not available here: without the camunda7 module, analytics cannot load BPMN files. Ask in the chat for the figures per activity instead.",
      ),
    ).toBeTruthy()
    expect(document.querySelector("[data-view-meta]")).toBeNull()
  })

  it("names the engine lookup when camunda7 is there but found no diagram (de)", () => {
    renderIn("de", AnalyticsBpmnHeatmap, { ...HEATMAP, bpmnMissing: "not-loaded" })
    expect(
      screen.getByText(
        "Das Diagramm konnte nicht geladen werden: Keine Engine dieser Ansicht hat es geliefert. Prüf, ob die Engines erreichbar sind und der Prozess bereitgestellt ist, oder frag im Chat nach den Kennzahlen je Aktivität.",
      ),
    ).toBeTruthy()
    expect(screen.queryByText(/camunda7-Modul/)).toBeNull()
  })

  it.each([undefined, "constructor"])(
    "names no cause it does not know (bpmnMissing: %s)",
    async (bpmnMissing) => {
      // Without a known cause the view reads the diagram feed, which has none.
      renderIn("en", AnalyticsBpmnHeatmap, { ...HEATMAP, bpmnMissing }, diagram(null))
      expect(
        await screen.findByText(
          "Could not load the diagram. Ask in the chat for the figures per activity instead.",
        ),
      ).toBeTruthy()
    },
  )
})
