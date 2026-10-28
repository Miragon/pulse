// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { LocaleProvider, queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import type {
  ClusterCompareResult,
  CompareKpiDelta,
  EngineCompareResult,
  VersionCompareKpi,
  VersionCompareResult,
} from "@miragon/pulse-analytics-client"
import { setFormatLocale } from "@miragon/pulse-widget-shell/testing"
import { VersionCompareWidget } from "./version-compare.js"
import { EngineCompareWidget } from "./engine-compare.js"
import { ClusterCompareWidget } from "./cluster-compare.js"

const NOW = "2026-10-10T12:40:00.000Z"
const AS_OF = "2026-10-10T12:32:00.000Z"

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(new Date(NOW))
})
afterEach(() => {
  cleanup()
  queryClient.clear()
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
      <WidgetFixtureHost
        widget={Widget as unknown as ComponentType<Record<string, unknown>>}
        data={data as Record<string, unknown>}
      />
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
  bucket: version === 1 ? "versionA" : "versionB",
  instance_count: 576,
  completed_count: 500,
  incident_count: 12,
  incident_rate_pct: 2.1,
  element_incident_count: null,
  element_incident_rate_pct: null,
  avg_duration_sec: 8340,
  p95_duration_sec: 20100,
  ...over,
})

const DELTA: CompareKpiDelta = {
  // Traffic moved to v2: a volume, never a verdict.
  started_per_day_delta_pct: -84.7,
  // Past the 1-per-100-starts threshold: worse.
  incident_rate_delta_pp: 1.4,
  element_incident_rate_delta_pp: null,
  // Slower by 25 %: past the 5 % duration threshold.
  avg_duration_delta_pct: 25,
  // Rounding jitter: below the threshold, neutral.
  p95_duration_delta_pct: 3,
}

const VERSION: VersionCompareResult = {
  engines: ["prod-leasing"],
  processDefinitionKey: "miraveloLeasing",
  versionA: 1,
  versionB: 2,
  windowDays: 14,
  minBucketSize: 10,
  suppressed: false,
  kpis: [versionKpi(1), versionKpi(2, { instance_count: 88 })],
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

const engineKpi = (engineId: string, bucket: "engineA" | "engineB", over = {}) => ({
  engineId,
  bucket,
  instance_count: 576,
  completed_count: 560,
  incident_count: 38,
  incident_rate_pct: 6.6,
  element_incident_count: null,
  element_incident_rate_pct: null,
  avg_duration_sec: 8340,
  p95_duration_sec: 20100,
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
    engineKpi("prod-leasing", "engineA"),
    engineKpi("test-leasing", "engineB", { instance_count: 88, incident_rate_pct: 6.8 }),
  ],
  delta: {
    started_per_day_delta_pct: -84.7,
    incident_rate_delta_pp: 0.2,
    element_incident_rate_delta_pp: null,
    avg_duration_delta_pct: -12,
    p95_duration_delta_pct: null,
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

const DEPLOYED_AT = Date.parse("2026-10-10T10:40:00.000Z")
const iso = (ms: number) => new Date(ms).toISOString()

/** `window_days` rounded to 0.01 d like the query does. */
function cluster(beforeSec: number, afterSec: number): ClusterCompareResult {
  const windows = {
    before: { from: DEPLOYED_AT - beforeSec * 1000, to: DEPLOYED_AT, seconds: beforeSec },
    after: { from: DEPLOYED_AT, to: DEPLOYED_AT + afterSec * 1000, seconds: afterSec },
  }
  const days = (seconds: number) => Math.round((seconds / 86_400) * 100) / 100
  return {
    engines: ["prod-a", "prod-b"],
    processDefinitionKey: "order",
    activityId: null,
    deploymentTimestamp: iso(DEPLOYED_AT),
    requestedWindowDays: { before: 7, after: 7 },
    windowDays: { before: days(beforeSec), after: days(afterSec) },
    partial: true,
    minBucketSize: 10,
    suppressed: false,
    kpis: (["before", "after"] as const).map((period) => ({
      period,
      window_from: iso(windows[period].from),
      window_to: iso(windows[period].to),
      window_days: days(windows[period].seconds),
      instance_count: 576,
      completed_count: 500,
      incident_count: 38,
      incident_rate_pct: 6.6,
      element_incident_count: null,
      element_incident_rate_pct: null,
      avg_duration_sec: 8340,
      p95_duration_sec: 20100,
    })),
    delta: DELTA,
    asOf: AS_OF,
  }
}

const HOUR = 3600
const DAY = 24 * HOUR
const CLUSTER = cluster(7 * DAY, 2 * HOUR)

describe("ClusterCompareWidget", () => {
  it("names the measured windows, a short one in hours (de)", () => {
    renderIn("de", ClusterCompareWidget, CLUSTER)
    expect(metaLine()).toBe("7 Tage davor, 2 Stunden danach · 2 Engines · Stand 14:32")
    expect(screen.getByText("Zeitraum gekürzt")).toBeTruthy()
    expect(within(screen.getByRole("table")).getByText("Vorher")).toBeTruthy()
  })

  it("says the same in English", () => {
    renderIn("en", ClusterCompareWidget, cluster(DAY, 1.5 * DAY))
    expect(metaLine()).toBe("1 day before, 1.5 days after · 2 engines · As of 14:32")
  })

  it("reads a window of a few minutes from its bounds, never as a rounded-up hour", () => {
    renderIn("de", ClusterCompareWidget, cluster(7 * DAY, 10 * 60))
    expect(metaLine()).toBe("7 Tage davor, 10 Minuten danach · 2 Engines · Stand 14:32")
  })

  it("says 'under 1 minute' for a deployment compared right away", () => {
    renderIn("en", ClusterCompareWidget, cluster(7 * DAY, 30))
    expect(metaLine()).toBe("7 days before, under 1 minute after · 2 engines · As of 14:32")
    cleanup()
    renderIn("de", ClusterCompareWidget, cluster(7 * DAY, 60))
    expect(metaLine()).toBe("7 Tage davor, 1 Minute danach · 2 Engines · Stand 14:32")
  })

  it("falls back to the rounded window length when the bounds do not parse", () => {
    const unparsable = cluster(7 * DAY, 2 * HOUR)
    unparsable.kpis = unparsable.kpis.map((kpi) => ({ ...kpi, window_from: "", window_to: "" }))
    renderIn("de", ClusterCompareWidget, unparsable)
    expect(metaLine()).toBe("7 Tage davor, 2 Stunden danach · 2 Engines · Stand 14:32")
  })

  it("hands off to assess the comparison with the Scale icon", () => {
    renderIn("de", ClusterCompareWidget, CLUSTER)
    const ask = screen.getByRole("button", { name: /Im Chat bewerten/ })
    expect(ask.querySelector("svg")?.getAttribute("class")).toContain("lucide-list-checks")
  })
})
