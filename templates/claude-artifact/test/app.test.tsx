// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  describePageError,
  formatCount,
  formatDate,
  formatInstant,
  formatNumber,
  resolveUiMessages,
  type PageErrorCode,
  type SectionFailure,
} from "@miragon/pulse-ui"
import { readBpmnNames, type DiagramCountKind } from "@miragon/pulse-ui/bpmn"
import { setFormatLocale } from "@miragon/pulse-ui/format"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type Fixture, mockClaude } from "../fixtures/mock-claude.ts"
import { Page } from "../src/app.tsx"
import {
  outcomesOf,
  type ActivityCounts,
  type ProcessStats,
} from "../src/data/process-dashboard.ts"
import { claudeConnector } from "../src/engine/claude-connector.ts"
import { EngineError, type Connector, type ToolResult } from "../src/engine/connector.ts"
import { callKey } from "../src/engine/engine.ts"
import { CLAUDE_PLACE, describeEngineError } from "../src/engine/errors.ts"
import { PAGE_TOOLS, type ToolName } from "../src/engine/tools.ts"
import { applyFormatLocale, viewerLocale } from "../src/locale.ts"
import { translate, type MessageKey } from "../src/messages.ts"
import { CONNECTOR_NAME, PROCESS_KEY } from "../src/page.config.ts"
import { goTo } from "../src/sections/anchors.ts"
import { countTargets } from "../src/sections/diagram.tsx"

/**
 * The page over the recorded fixtures, through the page's own connector: its structure, its
 * states and its calls, not its numbers, which change with every recording. Its words come from
 * its catalog and the kit's, never spelled out here, so a copy that rewords the page keeps these
 * tests.
 */

// bpmn-js needs a real SVG engine happy-dom lacks: a stand-in viewer over the elements of the XML
// it imports, so the diagram puts its counts on them as in a browser (the kit's own tests hold
// the drawing).
const bpmn = vi.hoisted(() => {
  class StandInViewer {
    elements: { id: string; type: string }[] = []
    readonly opts: { container: HTMLElement }
    constructor(opts: { container: HTMLElement }) {
      this.opts = opts
      opts.container.innerHTML = '<div class="djs-container"><svg tabindex="0"></svg></div>'
    }
    private known(id: string) {
      if (!this.elements.some((element) => element.id === id)) throw new Error(`no element ${id}`)
    }
    importXML(xml: string): Promise<{ warnings: string[] }> {
      this.elements = [...xml.matchAll(/<bpmn:(\w+) id="([^"]+)"/g)].map(([, tag, id]) => ({
        id: id ?? "",
        type: `bpmn:${(tag ?? "").charAt(0).toUpperCase()}${(tag ?? "").slice(1)}`,
      }))
      return Promise.resolve({ warnings: [] })
    }
    get(service: string): unknown {
      if (service === "canvas") {
        return {
          addMarker: (id: string) => {
            this.known(id)
          },
          viewbox: () => ({ x: 0, y: 0, width: 600, height: 300, scale: 1 }),
          zoom: () => 1,
          resized: () => {},
          getContainer: () => this.opts.container,
          scroll: () => {},
        }
      }
      if (service === "overlays") {
        return {
          add: (id: string, overlay: { html: HTMLElement }) => {
            this.known(id)
            this.opts.container.querySelector(".djs-container")?.appendChild(overlay.html)
          },
        }
      }
      if (service === "elementRegistry") return { getAll: () => this.elements }
      return { on: () => {}, off: () => {} }
    }
    destroy() {}
  }
  return { StandInViewer }
})

vi.mock("bpmn-js/lib/NavigatedViewer", () => ({ default: bpmn.StandInViewer }))

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, `../fixtures/${PROCESS_KEY}.json`), "utf8"),
) as Fixture
const asOf = new Date(fixture.asOf)
const counts = fixture.calls.find((call) => call.tool === "engine_activity_counts")?.result
  .structuredContent as ActivityCounts
const stats = fixture.calls.find((call) => call.tool === "engine_process_stats")?.result
  .structuredContent as ProcessStats
const xml = (
  fixture.calls.find((call) => call.tool === "engine_get_process_definition_xml")?.result
    .structuredContent as { bpmn20Xml: string }
).bpmn20Xml

function renderPage(language: string, fail: string[] = []) {
  const mock = mockClaude(fixture, { fail })
  const view = render(
    <Page
      connector={claudeConnector(mock)}
      language={language}
      now={() => asOf}
      timeZone={fixture.timeZone}
    />,
  )
  return { ...view, mock }
}

/** Renders the page over `connector` on the fixture's clock and zone. */
function renderOver(connector: Connector, now: () => Date = () => asOf) {
  return render(
    <Page connector={connector} language="en-US" now={now} timeZone={fixture.timeZone} />,
  )
}

/** An error result as the server sends one, the same text for every tool it hits. */
function failed(tool: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `[503 ServiceUnavailable] ${tool} failed (engine prod-a)` }],
  }
}

/**
 * The fixture as a connector the test steers: `failing` answers those tools with one error text
 * (one per tool), `throwing` refuses them in the runtime's code, `answer` replaces an answer.
 */
function steered(
  options: {
    failing?: Set<string>
    throwing?: Map<string, EngineError["code"]>
    answer?: (tool: string, recorded: ToolResult | undefined) => ToolResult | undefined
  } = {},
): Connector {
  const answers = new Map(
    fixture.calls.map((call) => [callKey(call.tool, call.arguments), call.result]),
  )
  return {
    callTool(name, args) {
      const code = options.throwing?.get(name)
      if (code !== undefined) return Promise.reject(new EngineError(code, name, `[${code}] raw`))
      if (options.failing?.has(name)) return Promise.resolve(failed(name))
      const recorded = answers.get(callKey(name, args))
      const result = options.answer?.(name, recorded) ?? recorded
      return Promise.resolve(result ?? failed(`unrecorded ${name}`))
    },
  }
}

/** The page's own words in English or German (its catalog). */
const en = (key: MessageKey, params?: Record<string, unknown>) => translate("en", key, params)
const de = (key: MessageKey) => translate("de", key)

/** The kit's words in English: its states, its buttons, the diagram's counts. */
const KIT = resolveUiMessages("en")
const TRY_AGAIN = KIT.common.retry
const SAME_FAILURE = KIT.sectionState.sameFailure

/** A refusal of the runtime as the page words it: the kit's page error on this page's connector. */
const refusal = (code: PageErrorCode) =>
  describePageError({ code }, { messages: KIT, connector: CONNECTOR_NAME, place: CLAUDE_PLACE.en })

/** How the page words the mock's failure of `tool` under `fail` (`?fail=`). */
async function failureOf(fail: string[], tool: ToolName): Promise<SectionFailure> {
  const error = await claudeConnector(mockClaude(fixture, { fail }))
    .callTool(tool, {})
    .then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
  if (!(error instanceof EngineError)) throw new Error(`The mock answered ${tool}.`)
  return describeEngineError(error, "en-US")
}

/** Every section has read: no region is busy any more. */
async function settled() {
  await waitFor(
    () => {
      expect(document.querySelector('[aria-busy="true"]')).toBeNull()
    },
    { timeout: 10_000 },
  )
}

const SECTION_HEADINGS = (
  ["diagram.title", "perDay.title", "outcomes.title", "incidents.title", "tasks.title"] as const
).map((key) => en(key))

const h2s = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent)

afterEach(() => {
  cleanup()
  setFormatLocale(undefined)
  vi.unstubAllGlobals()
})

describe("the dashboard on the fixtures", () => {
  it("shows the process, its tiles, its sections and its tables, and no failure", async () => {
    renderPage("en-US")
    await settled()
    const title = screen.getByRole("heading", { level: 1 })
    expect(title.textContent).not.toBe("")
    expect(screen.getAllByRole("main")).toHaveLength(1)
    expect(h2s()).toEqual(SECTION_HEADINGS)
    for (const key of [
      "kpi.running",
      "kpi.incidents",
      "kpi.withIncident",
      "kpi.failedJobs",
      "kpi.openTasks",
      "kpi.started",
      "kpi.ended",
    ] as const) {
      expect(screen.getAllByText(en(key)).length).toBeGreaterThan(0)
    }
    expect(screen.getByRole("table", { name: en("perDay.chart") })).toBeDefined()
    const { outcomes, ended } = outcomesOf(stats)
    if (outcomes.length > 0) {
      expect(screen.getByRole("list", { name: en("outcomes.label") })).toBeDefined()
      expect(screen.getByText(en("outcomes.shareOf", { count: formatCount(ended) }))).toBeDefined()
    } else {
      expect(screen.getByText(en("outcomes.empty"))).toBeDefined()
    }
    const incidents = screen.getByRole("region", { name: en("incidents.title") })
    expect(within(incidents).getAllByRole("table").length).toBeGreaterThan(0)
    expect(screen.queryAllByRole("alert")).toEqual([])
  })

  it("makes at most three calls a load, each tool of PAGE_TOOLS once, and three again on Refresh", async () => {
    const { mock } = renderPage("en-US")
    await settled()
    expect(mock.calls.length).toBeLessThanOrEqual(3)
    expect(mock.calls.map((call) => call.tool).sort()).toEqual([...PAGE_TOOLS].sort())
    fireEvent.click(screen.getByRole("button", { name: en("page.refresh") }))
    await settled()
    expect(mock.calls.length).toBeLessThanOrEqual(6)
    expect(
      mock.calls
        .slice(3)
        .map((call) => call.tool)
        .sort(),
    ).toEqual([...PAGE_TOOLS].sort())
  })

  it("has one banner: the bar's, never a header around it", async () => {
    renderPage("en-US")
    await settled()
    expect(document.querySelectorAll("header")).toHaveLength(1)
    expect(document.querySelectorAll("header header, header [role=banner]")).toHaveLength(0)
  })

  it("holds every id once", async () => {
    renderPage("en-US")
    await settled()
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
  })

  it("speaks German to a German viewer", async () => {
    renderPage("de-DE")
    await settled()
    expect(screen.getAllByText(de("kpi.incidents")).length).toBeGreaterThan(0)
    expect(screen.getByRole("heading", { level: 2, name: de("diagram.title") })).toBeDefined()
    expect(screen.getByRole("heading", { level: 2, name: de("outcomes.title") })).toBeDefined()
    expect(screen.getByRole("button", { name: de("page.refresh") })).toBeDefined()
  })

  it("keeps the page when one call fails: the failure in words once, Try again, the raw text under Details", async () => {
    renderPage("en-US", ["engine_process_stats"])
    await settled()
    const alerts = await screen.findAllByRole("alert")
    expect(alerts).toHaveLength(1)
    const words = await failureOf(["engine_process_stats"], "engine_process_stats")
    expect(within(alerts[0]).getByText(words.title)).toBeDefined()
    expect(within(alerts[0]).getByRole("button", { name: TRY_AGAIN })).toBeDefined()
    expect(within(alerts[0]).getByText(KIT.common.details)).toBeDefined()
    expect(within(alerts[0]).getByText(words.details ?? "")).toBeDefined()
    expect(screen.queryByText(en("kpi.running"))).toBeNull()
    // The chart and the end events read the same call: they say it once, after the tiles.
    expect(screen.getAllByText(SAME_FAILURE)).toHaveLength(2)
    expect(screen.getByRole("heading", { level: 2, name: en("tasks.title") })).toBeDefined()
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0)
  })

  it("refuses one tool with a runtime code and keeps the rest (?fail=<tool>:<code>)", async () => {
    renderPage("en-US", ["engine_activity_counts:server_unavailable"])
    await settled()
    const alerts = screen.getAllByRole("alert")
    expect(alerts).toHaveLength(1)
    const diagram = screen.getByRole("region", { name: en("diagram.title") })
    expect(within(diagram).getByRole("alert")).toBe(alerts[0])
    expect(within(alerts[0]).getByText(refusal("unavailable").title)).toBeDefined()
    expect(screen.getAllByText(en("kpi.running")).length).toBeGreaterThan(0)
  })
})

describe("a page the runtime refuses as a whole", () => {
  /** The page's one state: one alert under the bar, no section, no freshness. */
  function expectOneState(title: string) {
    expect(screen.getAllByText(title)).toHaveLength(1)
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(h2s()).toEqual([title])
    expect(screen.queryAllByRole("table")).toEqual([])
    expect(document.querySelector('[data-slot="freshness-stamp"]')).toBeNull()
    expect(within(screen.getByRole("main")).getByRole("alert").textContent).toContain(title)
  }

  it("says a missing connector once, in the sections' place", async () => {
    renderOver(claudeConnector(undefined))
    await settled()
    const words = refusal("not_connected")
    expectOneState(words.title)
    expect(screen.getAllByRole("button", { name: TRY_AGAIN })).toHaveLength(1)
    expect(screen.getByText(words.hint ?? "")).toBeDefined()
  })

  it("says a refusal of the runtime once, as the mock gives it (?fail=needs_reauth)", async () => {
    renderPage("en-US", ["needs_reauth"])
    await settled()
    const words = refusal("needs_reauth")
    expectOneState(words.title)
    expect(screen.getByText(words.hint ?? "")).toBeDefined()
  })

  it.each(["engine_process_stats", "engine_activity_counts"])(
    "closes the page when one read meets a refusal of the connector (%s), and Try again opens it",
    async (tool) => {
      const throwing = new Map([[tool, "needs_reauth" as const]])
      renderOver(steered({ throwing }))
      await settled()
      expectOneState(refusal("needs_reauth").title)
      throwing.clear()
      fireEvent.click(screen.getByRole("button", { name: TRY_AGAIN }))
      await waitFor(() => {
        expect(h2s()).toEqual(SECTION_HEADINGS)
      })
      await settled()
      expect(screen.queryAllByRole("alert")).toEqual([])
    },
  )
})

describe("sections that fail alike", () => {
  it("say it once: the first section in full, the next only that it was not read", async () => {
    const failing = new Set(["engine_activity_counts"])
    renderOver(steered({ failing }))
    await settled()
    const alerts = screen.getAllByRole("alert")
    expect(alerts).toHaveLength(1)
    const diagram = screen.getByRole("region", { name: en("diagram.title") })
    expect(within(diagram).getByRole("alert")).toBe(alerts[0])
    const incidents = screen.getByRole("region", { name: en("incidents.title") })
    expect(within(incidents).getByText(SAME_FAILURE)).toBeDefined()
    const tasks = screen.getByRole("region", { name: en("tasks.title") })
    expect(within(tasks).getByText(SAME_FAILURE)).toBeDefined()
    expect(screen.getAllByRole("button", { name: TRY_AGAIN })).toHaveLength(1)
    failing.clear()
    fireEvent.click(within(alerts[0]).getByRole("button", { name: TRY_AGAIN }))
    await waitFor(() => {
      expect(screen.queryAllByRole("alert")).toEqual([])
    })
    expect(screen.queryByText(SAME_FAILURE)).toBeNull()
    expect(within(incidents).getAllByRole("table").length).toBeGreaterThan(0)
  })

  it("offer no Try again for a call the page may not make", async () => {
    const throwing = new Map([["engine_process_stats", "not_allowed" as const]])
    renderOver(steered({ throwing }))
    await settled()
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByText(refusal("not_allowed").title)).toBeDefined()
    expect(screen.queryAllByRole("button", { name: TRY_AGAIN })).toEqual([])
    expect(screen.getByRole("heading", { level: 2, name: en("tasks.title") })).toBeDefined()
  })
})

describe("the bar's freshness", () => {
  /** The stamp's whole instant, its title. */
  const stamp = () => document.querySelector('[data-slot="freshness-stamp"]')?.getAttribute("title")

  /** The fixture's answers as the server gives them after a read `ms` later than the recording. */
  const readLater =
    (ms: () => number) =>
    (_tool: string, recorded: ToolResult | undefined): ToolResult | undefined => {
      const data = recorded?.structuredContent as { asOf?: string } | undefined
      if (recorded === undefined || data?.asOf === undefined) return undefined
      const asOfThen = new Date(Date.parse(data.asOf) + ms()).toISOString()
      return { ...recorded, structuredContent: { ...data, asOf: asOfThen } }
    }

  /** The oldest `asOf` of the page's answers, `ms` after the recorded ones. */
  const oldestRead = (ms = 0) =>
    formatInstant(
      new Date(Math.min(Date.parse(stats.asOf), Date.parse(counts.asOf)) + ms).toISOString(),
    )

  it("is when the server read the numbers (their asOf), never when an answer arrived", async () => {
    let clock = asOf
    let later = 0
    renderOver(steered({ answer: readLater(() => later) }), () => clock)
    await settled()
    expect(stamp()).toBe(oldestRead())

    // A Refresh 20 s on, inside the server's 30 s floor: it answers its first read again.
    clock = new Date(asOf.getTime() + 20_000)
    fireEvent.click(screen.getByRole("button", { name: en("page.refresh") }))
    await settled()
    expect(stamp()).toBe(oldestRead())

    // Past the floor the server reads anew, and the stamp moves with that read.
    later = 5 * 60_000
    clock = new Date(asOf.getTime() + later)
    fireEvent.click(screen.getByRole("button", { name: en("page.refresh") }))
    await waitFor(() => {
      expect(stamp()).toBe(oldestRead(later))
    })
  })

  it("shows the oldest read of the sections holding data, so a failed refresh keeps it", async () => {
    const later = 5 * 60_000
    let moved = 0
    const failing = new Set<string>()
    renderOver(steered({ failing, answer: readLater(() => moved) }))
    await settled()
    expect(stamp()).toBe(oldestRead())

    moved = later
    failing.add("engine_process_stats")
    fireEvent.click(screen.getByRole("button", { name: en("page.refresh") }))
    await settled()
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByText(en("kpi.running"))).toBeDefined()
    // The numbers per day are still the first read's: the bar keeps its stamp.
    expect(stamp()).toBe(formatInstant(stats.asOf))

    failing.clear()
    fireEvent.click(screen.getByRole("button", { name: en("page.refresh") }))
    await waitFor(() => {
      expect(screen.queryAllByRole("alert")).toEqual([])
    })
    await settled()
    expect(stamp()).toBe(oldestRead(later))
  })
})

describe("the incidents' anchors", () => {
  it.skipIf(counts.activities.length === 0)(
    "hold an activity's own row and its called line apart when it has both",
    async () => {
      const answer = (tool: string, recorded: ToolResult | undefined) => {
        if (tool !== "engine_activity_counts" || recorded === undefined) return undefined
        const counts = recorded.structuredContent as ActivityCounts
        const activities = counts.activities.map((row, i) =>
          i === 0 ? { ...row, incidents: 2, incidentsInCalledInstances: 3 } : row,
        )
        return { structuredContent: { ...counts, activities } }
      }
      renderOver(steered({ answer }))
      await settled()
      const ids = [...document.querySelectorAll("[id]")].map((element) => element.id)
      expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
      const own = ids.filter((id) => id.startsWith("incidents-row-"))
      expect(own.length).toBeGreaterThan(0)
      const called = own.map((id) => id.replace("incidents-row-", "calledIncidents-row-"))
      expect(called.some((id) => ids.includes(id))).toBe(true)
    },
  )
})

describe("a count on the diagram", () => {
  it("is a button where it leads to a row of the page, words without one elsewhere", async () => {
    renderPage("en-US")
    await settled()
    const diagram = screen.getByRole("region", { name: en("diagram.title") })
    // The kit's words of a count ("<element>: 3 incidents"), each count's description.
    const words: Record<DiagramCountKind, typeof KIT.bpmn.countRunning> = {
      incidents: KIT.bpmn.countIncidents,
      incidentsInCalledInstances: KIT.bpmn.countIncidentsInCalledInstances,
      running: KIT.bpmn.countRunning,
    }
    // The kit groups an element's counts under its name; a count that leads somewhere is a button.
    const linked = () =>
      within(diagram)
        .queryAllByRole("group")
        .flatMap((group) => within(group).queryAllByRole("button"))
    // Every count the recording holds on an element the drawing has, a button exactly where a row
    // of the page lists it (countTargets), whatever process the recording is of.
    const drawn = new Map(
      [...xml.matchAll(/<bpmn:(\w+) id="([^"]+)"/g)].map(([, tag = "", id = ""]) => [
        id,
        `bpmn:${tag.charAt(0).toUpperCase()}${tag.slice(1)}`,
      ]),
    )
    const names = readBpmnNames(xml).elements
    const expected = counts.decorations.flatMap(({ elementId, counts: shown }) => {
      const type = drawn.get(elementId)
      if (type === undefined) return []
      return shown
        .filter(({ count }) => count > 0)
        .filter(({ kind }) => countTargets({ id: elementId, type }, kind).length > 0)
        .map(({ kind, count }) =>
          words[kind]({ element: names[elementId] ?? elementId, count: formatCount(count) }),
        )
    })
    // The counts come after the data: the diagram draws them once bpmn-js has imported the XML,
    // which a loaded CI runner finished after the sections settled (main, 2026-11-24).
    await waitFor(
      () => {
        expect(linked()).toHaveLength(expected.length)
        for (const description of expected) {
          expect(within(diagram).getByRole("button", { description })).toBeDefined()
        }
      },
      { timeout: 10_000 },
    )
  })

  const task = { id: "Task_Review", type: "bpmn:UserTask" }
  const call = { id: "Activity_Assess", type: "bpmn:CallActivity" }

  it("leads to the row that lists it, else nowhere", () => {
    expect(countTargets(task, "running")).toEqual(["tasks-row-Task_Review", "tasks"])
    expect(countTargets(call, "running")).toEqual([])
    expect(countTargets(call, "incidents")).toEqual(["incidents-row-Activity_Assess", "incidents"])
    expect(countTargets(call, "incidentsInCalledInstances")).toEqual([
      "calledIncidents-row-Activity_Assess",
      "incidents",
    ])
  })

  /** A row of a list and its section, each an anchor with `tabIndex` -1. */
  function anchors() {
    document.body.innerHTML =
      '<section id="tasks" tabindex="-1"><span id="tasks-row-Task_Review" tabindex="-1">Review</span></section>'
    const row = document.getElementById("tasks-row-Task_Review") as HTMLElement
    const section = document.getElementById("tasks") as HTMLElement
    for (const element of [row, section]) element.scrollIntoView = vi.fn()
    return { row, section }
  }

  function prefersReducedMotion(reduce: boolean) {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reduce && query === "(prefers-reduced-motion: reduce)",
    }))
  }

  it("scrolls to its row, moves the focus there, and scrolls without motion when asked", () => {
    const { row } = anchors()
    prefersReducedMotion(false)
    act(() => {
      expect(goTo(["tasks-row-Task_Review", "tasks"])).toBe(true)
    })
    expect(row.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "center" })
    expect(document.activeElement).toBe(row)
    prefersReducedMotion(true)
    goTo(["tasks-row-Task_Review", "tasks"])
    expect(row.scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "center" })
  })

  it("falls back to the section, and to nothing on a page without either", () => {
    const { section } = anchors()
    prefersReducedMotion(false)
    expect(goTo(["tasks-row-Task_Other", "tasks"])).toBe(true)
    expect(section.scrollIntoView).toHaveBeenCalled()
    expect(document.activeElement).toBe(section)
    document.body.innerHTML = ""
    expect(goTo(["tasks-row-Task_Other", "tasks"])).toBe(false)
  })
})

describe("the days and their durations", () => {
  /** The fixture over a connector whose `engine_process_stats` answer `change` rewrites. */
  const statsAs = (change: (recorded: ProcessStats) => ProcessStats) =>
    steered({
      answer: (tool, recorded) =>
        tool === "engine_process_stats" && recorded !== undefined
          ? { ...recorded, structuredContent: change(recorded.structuredContent as ProcessStats) }
          : undefined,
    })

  const perDay = () => screen.getByRole("region", { name: en("perDay.title") })

  // The page's own wiring (src/locale.ts), not pulse-ui's formatter: the page hands its zone on.
  it("labels each day in the zone its bucket counts in, whatever the browser's own", () => {
    applyFormatLocale(viewerLocale("en-US"), "Pacific/Kiritimati")
    // 12:00 UTC on the 23rd is 02:00 on the 24th at UTC+14.
    expect(formatDate("2026-11-23T12:00:00.000Z")).toContain("24")
    applyFormatLocale(viewerLocale("en-US"), "UTC")
    expect(formatDate("2026-11-23T12:00:00.000Z")).toContain("23")
  })

  it("says the durations are of the instances that ended since the engine keeps their history", async () => {
    const since = new Date(Date.parse(stats.range.from) + 6 * 86_400_000).toISOString()
    renderOver(
      statsAs((s) => ({ ...s, durations: { from: since, ended: 7, medianMs: 1000, p90Ms: 2000 } })),
    )
    await settled()
    const scope = en("perDay.durationSince", { count: formatNumber(7), date: formatDate(since) })
    expect(within(perDay()).getByText(scope)).toBeDefined()
  })

  it("says no duration is known where the server knows none, never a duration of 0 instances", async () => {
    renderOver(statsAs((s) => ({ ...s, durations: null })))
    await settled()
    expect(within(perDay()).getByText(en("perDay.durationUnknown"))).toBeDefined()
    expect(within(perDay()).queryByText(en("perDay.durationScope", { count: "0" }))).toBeNull()
  })

  it("says an engine that writes no history leaves its counts unknown, never that none started", async () => {
    renderOver(
      statsAs((s) => ({
        ...s,
        history: { ...s.history, recorded: false },
        totals: { started: null, ended: null },
        buckets: s.buckets.map((b) => ({ ...b, started: null, ended: null, endedAt: {} })),
        endEvents: s.endEvents.map((event) => ({ ...event, ended: null })),
        durations: null,
      })),
    )
    await settled()
    expect(within(perDay()).getByText(en("perDay.noHistory"))).toBeDefined()
    expect(screen.queryByText(en("perDay.empty"))).toBeNull()
    const outcomes = screen.getByRole("region", { name: en("outcomes.title") })
    expect(screen.queryByText(en("outcomes.empty"))).toBeNull()
    expect(within(outcomes).queryByText(/%/)).toBeNull()
    expect(within(outcomes).getByText(en("outcomes.noShare"))).toBeDefined()
  })
})
