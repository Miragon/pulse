// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale } from "@miragon/pulse-ui"
import type {
  CompareKpiDelta,
  EngineCompareKpi,
  EngineCompareResult,
  PeriodCompareKpi,
  PeriodCompareResult,
  VersionCompareKpi,
  VersionCompareResult,
} from "@miragon/pulse-analytics-client"
import { VersionCompareWidget } from "./version-compare.js"
import { EngineCompareWidget } from "./engine-compare.js"
import { PeriodCompareWidget } from "./period-compare.js"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"

const NOW = "2026-10-10T12:40:00.000Z"
const AS_OF = "2026-10-10T12:32:00.000Z"

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  cleanup()
  setFormatLocale(undefined)
  vi.useRealTimers()
})

function renderIn(language: "de" | "en", Widget: ComponentType<{ data: never }>, data: unknown) {
  setFormatLocale({
    language,
    locale: language === "de" ? "de-DE" : "en-GB",
    timeZone: "Europe/Berlin",
  })
  return render(
    <LocaleProvider locale={language}>
      <TestViewHost>
        <Widget data={data as never} />
      </TestViewHost>
    </LocaleProvider>,
  )
}

function deltaCell(label: string) {
  const row = screen.getByText(label).closest("tr")!
  const cell = row.querySelector("[data-verdict]")!
  return {
    verdict: cell.getAttribute("data-verdict"),
    text: cell.textContent.replace(/\u00a0/g, " "),
    icon: cell.querySelector("svg")?.getAttribute("class") ?? null,
  }
}

const metaLine = () =>
  document.querySelector("[data-view-meta]")?.textContent?.replace(/\u00a0/g, " ")

const versionKpi = (version: number, over: Partial<VersionCompareKpi> = {}): VersionCompareKpi => ({
  version,
  startedCount: 576,
  completedCount: 500,
  incidentsCreated: 12,
  incidentRatePct: 2.1,
  elementIncidentsCreated: null,
  elementIncidentRatePct: null,
  avgDurationMs: 8_340_000,
  medianDurationMs: 7_200_000,
  p95DurationMs: 20_100_000,
  ...over,
})

const DELTA: CompareKpiDelta = {
  // Traffic moved to v2: a volume, never a verdict.
  startedPerDayDeltaPct: -84.7,
  // Past the 1-per-100-starts threshold: worse.
  incidentRateDeltaPp: 1.4,
  elementIncidentRateDeltaPp: null,
  // Slower by 25 %: past the 5 % duration threshold.
  avgDurationDeltaPct: 25,
  // Rounding jitter: below the threshold, neutral.
  p95DurationDeltaPct: 3,
}

const VERSION: VersionCompareResult = {
  engines: ["prod-leasing"],
  processDefinitionKey: "miraveloLeasing",
  versionA: 1,
  versionB: 2,
  windowDays: 14,
  minBucketSize: 10,
  suppressed: false,
  kpis: [versionKpi(1), versionKpi(2, { startedCount: 88 })],
  delta: DELTA,
  asOf: AS_OF,
}

describe("VersionCompareWidget in German", () => {
  it("judges quality from its threshold on and never the volume", () => {
    renderIn("de", VersionCompareWidget, VERSION)

    expect(screen.getByText("Versionsvergleich")).toBeTruthy()
    expect(screen.getByText("Änderung")).toBeTruthy()
    expect(screen.getByText("v1 → v2")).toBeTruthy()

    const starts = deltaCell("Starts (Änderung je Tag)")
    expect(starts).toEqual({ verdict: "none", text: "-84,7 %", icon: null })

    const avg = deltaCell("Durchschnittliche Dauer")
    expect(avg.verdict).toBe("worse")
    expect(avg.text).toBe("+25 %schlechter")
    expect(avg.icon).toContain("lucide-trending-up")
    expect(avg.icon).toContain("text-danger")

    expect(deltaCell("P95-Dauer")).toEqual({ verdict: "none", text: "+3 %", icon: null })
    // Incidents are measured per version; a process-wide comparison has no element row.
    expect(deltaCell("Incidents je 100 Starts").verdict).toBe("worse")
    expect(deltaCell("Incidents je 100 Starts").text).toBe("+1,4schlechter")
    expect(screen.queryAllByText("nicht gemessen")).toHaveLength(0)
    expect(screen.queryByText("Incidents je 100 Starts am Element")).toBeNull()
  })

  it("states the reference frame and hands off with a verb that names the chat", () => {
    renderIn("de", VersionCompareWidget, VERSION)
    expect(metaLine()).toBe("Letzte 14 Tage · 1 Engine · Stand 14:32")
    const ask = screen.getByRole("button", { name: /Im Chat bewerten/ })
    expect(ask.querySelector("svg")?.getAttribute("class")).toContain("lucide-list-checks")
  })

  it("calls every quality change of a suppressed comparison not reliable", () => {
    renderIn("de", VersionCompareWidget, { ...VERSION, suppressed: true })

    expect(screen.getByText("Zu wenig Daten: weniger als 10 Instanzen je Version")).toBeTruthy()
    const avg = deltaCell("Durchschnittliche Dauer")
    expect(avg).toEqual({ verdict: "notReliable", text: "+25 %nicht belastbar", icon: null })
    expect(deltaCell("Starts (Änderung je Tag)").verdict).toBe("none")
    expect(screen.queryByText("schlechter")).toBeNull()
    expect(screen.queryByText("besser")).toBeNull()
  })
})

const engineKpi = (engineId: string, over: Partial<EngineCompareKpi> = {}): EngineCompareKpi => ({
  engineId,
  startedCount: 576,
  completedCount: 560,
  incidentsCreated: 38,
  incidentRatePct: 6.6,
  elementIncidentsCreated: null,
  elementIncidentRatePct: null,
  avgDurationMs: 8_340_000,
  medianDurationMs: 7_200_000,
  p95DurationMs: 20_100_000,
  ...over,
})

const ENGINES: EngineCompareResult = {
  engineA: "prod-leasing",
  engineB: "test-leasing",
  processDefinitionKey: "miraveloLeasing",
  windowDays: 14,
  activityId: null,
  minBucketSize: 10,
  suppressed: false,
  kpis: [
    engineKpi("prod-leasing"),
    engineKpi("test-leasing", { startedCount: 88, incidentRatePct: 6.8 }),
  ],
  delta: {
    startedPerDayDeltaPct: -84.7,
    incidentRateDeltaPp: 0.2,
    elementIncidentRateDeltaPp: null,
    avgDurationDeltaPct: -12,
    p95DurationDeltaPct: null,
  },
  asOf: AS_OF,
}

describe("EngineCompareWidget in English", () => {
  it("keeps less traffic on a test engine and a rounding-size rate change neutral", () => {
    renderIn("en", EngineCompareWidget, ENGINES)

    expect(deltaCell("Starts (change per day)")).toEqual({
      verdict: "none",
      text: "-84.7%",
      icon: null,
    })
    expect(deltaCell("Incidents per 100 starts")).toEqual({
      verdict: "none",
      text: "+0.2",
      icon: null,
    })
    const avg = deltaCell("Avg duration")
    expect(avg.verdict).toBe("better")
    expect(avg.text).toBe("-12%better")
    expect(avg.icon).toContain("lucide-trending-down")
    expect(avg.icon).toContain("text-success")
    expect(screen.getByText("6.6")).toBeTruthy()
    expect(metaLine()).toBe("Last 14 days · As of 14:32")
    const ask = screen.getByRole("button", { name: /Assess in chat/ })
    expect(ask.querySelector("svg")?.getAttribute("class")).toContain("lucide-list-checks")
  })

  it("shows the suppressed chip as a neutral note, not an error", () => {
    renderIn("en", EngineCompareWidget, { ...ENGINES, suppressed: true, minBucketSize: 1 })
    const chip = screen.getByText("Too little data: fewer than 1 instance per engine")
    expect(chip.closest("[data-suppressed]")?.className).not.toMatch(/(^|\s)(bg|text)-destructive/)
    expect(deltaCell("Avg duration").text).toBe("-12%not reliable")
  })
})

const SPLIT = Date.parse("2026-10-10T10:40:00.000Z")
const iso = (ms: number) => new Date(ms).toISOString()

/** Two periods split at one instant; `days` rounded to 0.01 d like the query does. */
function periods(aSec: number, bSec: number): PeriodCompareResult {
  const days = (seconds: number) => Math.round((seconds / 86_400) * 100) / 100
  const kpi = (from: number, seconds: number): PeriodCompareKpi => ({
    from: iso(from),
    to: iso(from + seconds * 1000),
    days: days(seconds),
    partial: false,
    startedCount: 576,
    startedPerDay: 82.3,
    completedCount: 500,
    incidentsCreated: 38,
    incidentRatePct: 6.6,
    elementIncidentsCreated: null,
    elementIncidentRatePct: null,
    avgDurationMs: 8_340_000,
    medianDurationMs: 7_200_000,
    p95DurationMs: 20_100_000,
  })
  return {
    engines: ["prod-a", "prod-b"],
    processDefinitionKey: "order",
    activityId: null,
    periodAFrom: iso(SPLIT - 7 * 86_400_000),
    periodATo: iso(SPLIT),
    periodBFrom: iso(SPLIT),
    periodBTo: iso(SPLIT + 7 * 86_400_000),
    minBucketSize: 10,
    suppressed: false,
    partial: true,
    kpis: [kpi(SPLIT - aSec * 1000, aSec), { ...kpi(SPLIT, bSec), partial: true }],
    delta: DELTA,
    asOf: AS_OF,
  }
}

const HOUR = 3600
const DAY = 24 * HOUR
const PERIODS = periods(7 * DAY, 2 * HOUR)

describe("PeriodCompareWidget", () => {
  it("names the measured periods, a short one in hours (de)", () => {
    renderIn("de", PeriodCompareWidget, PERIODS)
    expect(metaLine()).toBe("A 7 Tage, B 2 Stunden · 2 Engines · Stand 14:32")
    expect(screen.getByText("Zeitraum gekürzt")).toBeTruthy()
    expect(within(screen.getByRole("table")).getByText("Zeitraum A")).toBeTruthy()
    expect(within(screen.getByRole("table")).getByText("Zeitraum B")).toBeTruthy()
  })

  it("says the same in English", () => {
    renderIn("en", PeriodCompareWidget, periods(DAY, 1.5 * DAY))
    expect(metaLine()).toBe("A 1 day, B 1.5 days · 2 engines · As of 14:32")
    expect(within(screen.getByRole("table")).getByText("Period A")).toBeTruthy()
  })

  it("reads a period of a few minutes from its bounds, never as a rounded-up hour", () => {
    renderIn("de", PeriodCompareWidget, periods(7 * DAY, 10 * 60))
    expect(metaLine()).toBe("A 7 Tage, B 10 Minuten · 2 Engines · Stand 14:32")
  })

  it("says 'under 1 minute' for a period compared right away", () => {
    renderIn("en", PeriodCompareWidget, periods(7 * DAY, 30))
    expect(metaLine()).toBe("A 7 days, B under 1 minute · 2 engines · As of 14:32")
    cleanup()
    renderIn("de", PeriodCompareWidget, periods(7 * DAY, 60))
    expect(metaLine()).toBe("A 7 Tage, B 1 Minute · 2 Engines · Stand 14:32")
  })

  it("hands off to assess the comparison with the Scale icon", () => {
    renderIn("de", PeriodCompareWidget, PERIODS)
    const ask = screen.getByRole("button", { name: /Im Chat bewerten/ })
    expect(ask.querySelector("svg")?.getAttribute("class")).toContain("lucide-list-checks")
  })
})
