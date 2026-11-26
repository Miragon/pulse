// @vitest-environment happy-dom
import { cleanup, fireEvent, render, renderHook, within } from "@testing-library/react"
import { LocaleProvider, setFormatLocale, TONE_ICON } from "@miragon/pulse-ui"
import { FleetSums, type EngineScreenData } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { ScreenSlots } from "../slots.js"
import { editorSlots, pageSlots } from "../slots.test-support.js"
import { EngineTable, type EngineRowData } from "./engine-table.js"
import { useFleetSums } from "./fleet-sums.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const CLUSTER: EngineScreenData = {
  engine: "c8-eu",
  asOf: "2026-11-19T09:00:00.000Z",
  info: null,
  processes: [
    {
      bpmnProcessId: "billing",
      latestVersion: 9,
      running: 14_000,
      withIncident: 12_000,
      incidents: 10_000,
      incidentsAtLeast: true,
    },
    { bpmnProcessId: "audit", latestVersion: 1, running: 2, withIncident: 0, incidents: 0 },
  ],
  totals: { processes: 2, running: 14_002, withIncident: 12_000 },
}

const [WORLD, FLOODED] = FleetSums.of([WORLD_SCREENS.engine, CLUSTER]).engines

const ROWS: readonly EngineRowData[] = [
  { engine: "conformance", state: "read", sums: WORLD! },
  { engine: "c8-eu", state: "read", sums: FLOODED! },
  { engine: "down", state: "failed" },
  { engine: "locked", state: "refused" },
  { engine: "slow", state: "loading" },
]

function shown(slots: ScreenSlots, locale = "en", engines: readonly EngineRowData[] = ROWS) {
  return render(
    <LocaleProvider locale={locale}>
      <EngineTable engines={engines} slots={slots} />
    </LocaleProvider>,
  ).container
}

function cells(container: HTMLElement): string[][] {
  return [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent),
  )
}

describe("the engines side by side, in the editors' table", () => {
  it("shows each engine's product and the figures of its engine screen, its incidents summed over its rows", () => {
    const container = shown(editorSlots().slots)

    expect([...container.querySelectorAll("thead th")].map((head) => head.textContent)).toEqual([
      "Engine",
      "Product",
      "Processes",
      "Running",
      "With incident",
      "Incidents",
    ])
    expect(cells(container).slice(0, 2)).toEqual([
      ["conformance", "Fake engine 1.0.0", "3", "5", "3Has open incidents", "2Has open incidents"],
      [
        "c8-eu",
        "—The engine didn't say what it is",
        "2",
        "14,002",
        "12,000Has open incidents",
        "≥\u00a010,000Has open incidents",
      ],
    ])
  })

  it("keeps a row for an engine without figures, its state in words beside its id and a dash per figure", () => {
    const container = shown(editorSlots().slots)
    const rows = cells(container).slice(2)

    expect(rows.map((row) => row[0])).toEqual([
      "downnot read",
      "lockedprofile refused",
      "slowloading…",
    ])
    expect(rows[0]?.slice(1)).toEqual(Array(5).fill("—not read"))
    expect(
      [...container.querySelectorAll('[data-part="engine"]')].map((cell) =>
        cell.getAttribute("data-state"),
      ),
    ).toEqual(["read", "read", "failed", "refused", "loading"])
  })

  it("keeps a quiet row, no tone, for an engine read nothing of for a reason not its own", () => {
    const container = shown(editorSlots().slots, "en", [
      { engine: "away", state: "unread" },
      { engine: "down", state: "failed" },
    ])
    const [away, down] = [...container.querySelectorAll<HTMLElement>('[data-part="engine"]')]

    expect(cells(container)[0]).toEqual(["awaynot read", ...Array<string>(5).fill("—not read")])
    expect(away?.getAttribute("data-state")).toBe("unread")
    expect(away?.querySelector("svg")?.getAttribute("class")).toContain("text-muted-foreground")
    expect(away?.querySelector("svg")?.getAttribute("class")).not.toContain(TONE_ICON.warning)
    // A read that failed is the engine's: its warning mark.
    expect(down?.querySelector("svg")?.getAttribute("class")).toContain(TONE_ICON.warning)
    const german = shown(editorSlots().slots, "de", [{ engine: "away", state: "unread" }])
    expect(cells(german)[0]?.[0]).toBe("awaynicht gelesen")
  })

  it("marks an alarming count by its icon and words, never by its colour, and 0 not at all", () => {
    const container = shown(editorSlots().slots)
    const [first] = container.querySelectorAll("tbody tr")

    expect(
      [...first!.querySelectorAll("[data-part][data-tone]")].map((cell) =>
        cell.getAttribute("data-part"),
      ),
    ).toEqual(["incident-count", "root-incident-count"])
    expect(within(first as HTMLElement).getAllByText("Has open incidents")).toHaveLength(2)
    const quiet = shown(editorSlots().slots, "en", [
      {
        engine: "calm",
        state: "read",
        sums: { ...WORLD!, engine: "calm", withIncident: 0, incidents: 0 },
      },
    ])
    expect(quiet.querySelectorAll("[data-part][data-tone]")).toHaveLength(0)
  })

  it("opens a row's engine and copies its id, each row named by its engine", () => {
    const { slots, asked } = editorSlots()
    const container = shown(slots)
    const rows = within(container).getAllByRole("row").slice(1)

    fireEvent.click(rows[2] as HTMLElement)
    fireEvent.keyDown(rows[3] as HTMLElement, { key: "c", ctrlKey: true })

    expect(asked.opened).toEqual([
      { target: { kind: "engine", engine: "down" }, how: { toSide: false } },
    ])
    expect(asked.copied).toEqual([{ text: "locked", label: "engine ID" }])
    expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
      "Engine conformance",
      "Engine c8-eu",
      "Engine down",
      "Engine locked",
      "Engine slow",
    ])
  })

  it("says the server names no engine where it lists none", () => {
    const container = shown(editorSlots().slots, "en", [])

    expect(container.querySelector('[data-part="table-empty"]')?.textContent).toBe(
      "No engine is configured on this server.",
    )
  })
})

describe("the engines side by side, in a page's table", () => {
  it("links each row to its engine's address and drops the product, the processes and the running in a narrow region", () => {
    const { slots, asked } = pageSlots()
    const container = shown(slots)
    const rows = [...container.querySelectorAll("tbody tr")]

    expect(rows.map((row) => row.getAttribute("data-href"))).toEqual([
      "/app/engines/conformance",
      "/app/engines/c8-eu",
      "/app/engines/down",
      "/app/engines/locked",
      "/app/engines/slow",
    ])
    expect(
      [...container.querySelectorAll("thead th")].map((head) =>
        head.getAttribute("data-hide-below"),
      ),
    ).toEqual([null, "40rem", "40rem", "40rem", null, null])
    fireEvent.keyDown(rows[0] as HTMLElement, { key: "Enter" })
    expect(asked.opened).toEqual([
      { target: { kind: "engine", engine: "conformance" }, how: { toSide: false } },
    ])
  })

  it("speaks German on a German host", () => {
    const container = shown(pageSlots().slots, "de")

    expect([...container.querySelectorAll("thead th")].map((head) => head.textContent)).toEqual([
      "Engine",
      "Produkt",
      "Prozesse",
      "Laufend",
      "Mit Incident",
      "Incidents",
    ])
    expect(
      cells(container)
        .slice(2)
        .map((row) => row[0]),
    ).toEqual(["downnicht gelesen", "lockedProfil abgelehnt", "slowlädt…"])
    expect(container.querySelector("tbody tr")?.getAttribute("aria-label")).toBe(
      "Engine conformance",
    )
  })
})

describe("the engine screens summed in the browser", () => {
  it("give each engine's row and what runs where, as FleetSums does, the same answer while the screens stay", () => {
    const screens = [WORLD_SCREENS.engine, CLUSTER]
    const { result, rerender } = renderHook(({ shown }) => useFleetSums(shown), {
      initialProps: { shown: screens },
    })
    const first = result.current
    rerender({ shown: screens })

    expect(first).toEqual(FleetSums.of(screens))
    expect(result.current).toBe(first)
  })
})
