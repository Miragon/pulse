// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react"
import {
  LocaleProvider,
  READ_FAILURE_TONES,
  setFormatLocale,
  TONE_DOT,
  TONE_ICON,
  VERDICT_TONES,
} from "@miragon/pulse-ui"
import { FleetSums } from "@miragon/pulse-screens"
import { WORLD_SCREENS } from "@miragon/pulse-screens/testing"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { editorSlots, pageSlots } from "../slots.test-support.js"
import { EngineTable, type EngineRowData } from "./engine-table.js"
import { type EngineVerdict, EngineVerdictBadge } from "./engine-verdict.js"

afterEach(cleanup)

beforeEach(() => {
  setFormatLocale({ language: "en", locale: "en-u-hc-h23", timeZone: "UTC" })
})

const [WORLD] = FleetSums.of([WORLD_SCREENS.engine]).engines
const EMPTY = { ...WORLD!, processes: 0, running: 0, withIncident: 0, incidents: 0 }

const read = (engine: string, verdict?: EngineVerdict, sums = WORLD!): EngineRowData => ({
  engine,
  state: "read",
  sums: { ...sums, engine },
  ...(verdict === undefined ? {} : { verdict }),
})

const ROWS: readonly EngineRowData[] = [
  read("stable", "ok"),
  read("degraded", "warning"),
  read("critical", "critical"),
  read("empty", "ok", EMPTY),
  read("down", "unreachable"),
  read("locked-out", "unauthorized"),
  read("denied", "forbidden"),
  read("reading", "loading"),
  read("away", "unread"),
  read("cluster", "none"),
  read("unsaid"),
  { engine: "broken", state: "failed" },
]

function table(locale = "en", rows: readonly EngineRowData[] = ROWS, withVerdict = true) {
  return render(
    <LocaleProvider locale={locale}>
      <EngineTable engines={rows} slots={pageSlots().slots} withVerdict={withVerdict} />
    </LocaleProvider>,
  ).container
}

/** Each row's State cell: its text and the state it shows. */
function states(container: HTMLElement) {
  return [...container.querySelectorAll("tbody tr")].map((row) => {
    const cell = row.querySelectorAll("td")[1]
    const part = cell?.querySelector('[data-part="engine-verdict"]')
    return [cell?.textContent, part?.getAttribute("data-state") ?? null]
  })
}

describe("the engines' live state in the table's column State", () => {
  it("shows each engine's verdict, a failed read of it, and a dash that says why where none shows", () => {
    const container = table()

    expect(
      [...container.querySelectorAll("thead th")].map((head) => [
        head.textContent,
        head.getAttribute("data-hide-below"),
      ]),
    ).toEqual([
      ["Engine", null],
      ["State", null],
      ["Product", "40rem"],
      ["Processes", "40rem"],
      ["Running", "40rem"],
      ["With incident", null],
      ["Incidents", null],
    ])
    expect(states(container)).toEqual([
      ["Stable", "ok"],
      ["Degraded", "warning"],
      ["Critical", "critical"],
      ["Empty", "empty"],
      ["Unreachable", "unreachable"],
      ["Credentials rejected", "unauthorized"],
      ["Access denied", "forbidden"],
      ["—loading…", null],
      ["—not read", null],
      ["—Pulse judges no state for this engine", null],
      ["—Pulse judges no state for this engine", null],
      ["—not read", null],
    ])
  })

  it("marks each state by a mark of its own shape in its tone, never by colour alone", () => {
    const container = table()
    const cell = (engine: string) =>
      [...container.querySelectorAll("tbody tr")]
        .find((row) => row.getAttribute("aria-label") === `Engine ${engine}`)!
        .querySelector<HTMLElement>('[data-part="engine-verdict"]')!
    /** A cell's mark: an ok engine's dot, else its icon. */
    const markOf = (engine: string) =>
      (cell(engine).querySelector('[data-part="verdict"]') ?? cell(engine).querySelector("svg"))!
    /** What the mark draws: the dot, else the icon's own paths, so two shapes never compare equal. */
    const shapeOf = (engine: string) => {
      const mark = markOf(engine)
      return mark.tagName.toLowerCase() === "svg" ? mark.innerHTML : "dot"
    }

    expect(markOf("stable").getAttribute("class")).toContain(TONE_DOT[VERDICT_TONES.ok])
    expect(markOf("degraded").getAttribute("class")).toContain(TONE_ICON.warning)
    expect(markOf("critical").getAttribute("class")).toContain(TONE_ICON.danger)
    // An empty engine is neutral, its dashed circle: never a check over nothing deployed.
    expect(markOf("empty").getAttribute("class")).toContain("text-muted-foreground")
    expect(markOf("down").getAttribute("class")).toContain(
      TONE_ICON[READ_FAILURE_TONES.unreachable],
    )
    expect(markOf("denied").getAttribute("class")).toContain(TONE_ICON.warning)
    // Under 28rem the mark shows alone (forced colours paint every mark alike): each state its
    // own shape, so Stable, Degraded and Critical never differ by colour alone.
    const shapes = ["stable", "degraded", "critical", "empty", "down", "locked-out"].map(shapeOf)
    expect(new Set(shapes).size).toBe(shapes.length)
    // The word stays in the title and for a screen reader where a narrow region hides it.
    expect(cell("degraded").getAttribute("title")).toBe("Degraded")
    expect(cell("degraded").querySelector(".truncate")!.className).toContain("@max-md:sr-only")
  })

  it("speaks German on a German host", () => {
    const container = table("de")

    expect(container.querySelectorAll("thead th")[1]?.textContent).toBe("Zustand")
    expect(states(container).map(([text]) => text)).toEqual([
      "Stabil",
      "Beeinträchtigt",
      "Kritisch",
      "Leer",
      "Nicht erreichbar",
      "Zugangsdaten abgelehnt",
      "Zugriff verweigert",
      "—lädt…",
      "—nicht gelesen",
      "—Pulse beurteilt den Zustand dieser Engine nicht",
      "—Pulse beurteilt den Zustand dieser Engine nicht",
      "—nicht gelesen",
    ])
  })

  it("leaves the column out where the surface shows no verdict, as the editors", () => {
    const container = render(
      <LocaleProvider locale="en">
        <EngineTable engines={ROWS} slots={editorSlots().slots} />
      </LocaleProvider>,
    ).container

    expect(
      [...container.querySelectorAll("thead th")].map((head) => head.textContent),
    ).not.toContain("State")
    expect(container.querySelector('[data-part="engine-verdict"]')).toBeNull()
  })
})

describe("the engine's live state in its screen's bar", () => {
  function badge(verdict: EngineVerdict, locale = "en", figures = { processes: 3, incidents: 2 }) {
    return render(
      <LocaleProvider locale={locale}>
        <EngineVerdictBadge verdict={verdict} figures={figures} />
      </LocaleProvider>,
    ).container
  }

  it("is the verdict's word in its tone, a failed read's in the tone of a failed read", () => {
    const shown = (verdict: EngineVerdict) => {
      const container = badge(verdict)
      const status = container.querySelector('[data-slot="status-badge"]')
      cleanup()
      return [status?.textContent, status?.getAttribute("data-tone")]
    }

    expect(shown("ok")).toEqual(["Stable", "neutral"])
    expect(shown("warning")).toEqual(["Degraded", "warning"])
    expect(shown("critical")).toEqual(["Critical", "danger"])
    expect(shown("unreachable")).toEqual(["Unreachable", "danger"])
    expect(shown("unauthorized")).toEqual(["Credentials rejected", "warning"])
    expect(shown("refused")).toEqual(["Profile refused", "warning"])
  })

  it("says Empty, neutral, for an ok engine with nothing deployed, never over its verdict", () => {
    const empty = badge("ok", "de", { processes: 0, incidents: 0 })
    expect(empty.querySelector('[data-slot="status-badge"]')?.textContent).toBe("Leer")
    cleanup()
    const degraded = badge("warning", "en", { processes: 0, incidents: 0 })
    expect(degraded.querySelector('[data-slot="status-badge"]')?.textContent).toBe("Degraded")
    cleanup()
    const unread = render(
      <LocaleProvider locale="en">
        <EngineVerdictBadge verdict="ok" />
      </LocaleProvider>,
    ).container
    expect(unread.querySelector('[data-slot="status-badge"]')?.textContent).toBe("Stable")
  })

  it("shows nothing while it reads, where it was not read or where the server decides none", () => {
    for (const verdict of ["loading", "unread", "none"] as const) {
      expect(badge(verdict).innerHTML).toBe("")
      cleanup()
    }
  })
})
