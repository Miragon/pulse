// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act } from "react"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import {
  formatCount,
  formatDate,
  formatInstant,
  formatNumber,
  resolveUiMessages,
  type PageErrorCode,
  type SectionFailure,
} from "@miragon/pulse-ui"
import { readBpmnNames, type DiagramCountKind } from "@miragon/pulse-ui/bpmn"
import { getFormatTimeZone, setFormatLocale } from "@miragon/pulse-ui/format"
import {
  ARTIFACT_PAGE_HINTS,
  mountClaudeArtifact,
  type MountClaudeArtifactOptions,
} from "@miragon/pulse-widget-shell/claude-artifact"
import {
  createPageReader,
  createTestQueryClient,
  describePageFailure,
  PageCallError,
  playRecording,
  type PlayedCall,
  type ToolCaller,
  type ToolResult,
} from "@miragon/pulse-widget-shell/widgets"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { Fixture } from "../fixtures/fixture.ts"
import { App } from "../src/app.tsx"
import {
  outcomesOf,
  type ActivityCounts,
  type ProcessStats,
} from "../src/data/process-dashboard.ts"
import { translate, type MessageKey } from "../src/messages.ts"
import { CONNECTOR_NAME, PAGE_TOOLS, PROCESS_KEY, type ToolName } from "../src/page.config.ts"
import { goTo } from "../src/sections/anchors.ts"
import { countTargets } from "../src/sections/diagram.tsx"

/**
 * The page mounted as the artifact mounts it (`mountClaudeArtifact`), its calls replayed from the
 * recorded fixtures (`playRecording`, the dev page's caller): its structure, its states and its
 * calls, not its numbers, which change with every recording. Its words come from its catalog and
 * the kit's, never spelled out here, so a copy that rewords the page keeps these tests. How a
 * section reads, the page's gate, its Refresh and its freshness are widget-shell's page reads, and
 * the artifact runtime's caller is widget-shell's too: their own suites hold them, these the page
 * on them.
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
const counts = fixture.calls.find((call) => call.tool === "engine_activity_counts")?.result
  .structuredContent as ActivityCounts
const stats = fixture.calls.find((call) => call.tool === "engine_process_stats")?.result
  .structuredContent as ProcessStats
const xml = (
  fixture.calls.find((call) => call.tool === "engine_get_process_definition_xml")?.result
    .structuredContent as { bpmn20Xml: string }
).bpmn20Xml

/** An error answer as the server sends one. */
function failed(tool: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `[503 ServiceUnavailable] ${tool} failed (engine prod-a)` }],
  }
}

interface PageOptions {
  /** The viewer's language tag. */
  locale?: string
  /** What the recording fails, as `?fail=` takes it (a tool, a page error code, `tool:code`). */
  fail?: string[]
  /** Tools that answer a server's error; the test changes it while the page runs. */
  failing?: ReadonlySet<string>
  /** Tools refused with a code before a tool answers; the test changes it while the page runs. */
  refusing?: ReadonlyMap<string, PageErrorCode>
  /** Replaces a recorded answer; undefined keeps it. */
  answer?: (tool: string, recorded: ToolResult) => ToolResult | undefined
}

let unmount: (() => void) | undefined

/**
 * Mounts the page as the artifact does, on the fixture's clock and zone, its calls answered by the
 * recording as the dev page's are, steered by `options`; `calls` lists every call that reached the
 * recording, in order.
 */
async function mountPage(options: PageOptions = {}): Promise<{ calls: PlayedCall[] }> {
  const calls: PlayedCall[] = []
  const played = playRecording(fixture, {
    fail: options.fail,
    tools: PAGE_TOOLS,
    connector: CONNECTOR_NAME,
    onCall: (call) => calls.push(call),
  })
  const callTool: ToolCaller = async (tool, args, callOptions) => {
    const recorded = await played.callTool(tool, args, callOptions)
    const code = options.refusing?.get(tool)
    if (code !== undefined) {
      throw new PageCallError(code, `[${code}] raw`, { tool, connector: CONNECTOR_NAME })
    }
    if (options.failing?.has(tool)) return failed(tool)
    return options.answer?.(tool, recorded) ?? recorded
  }
  await mountWith({ locale: options.locale ?? "en-US", ...played, callTool })
  return { calls }
}

/** Mounts the page as the artifact does, with `extra` of mountClaudeArtifact's options. */
async function mountWith(extra: Omit<MountClaudeArtifactOptions, "connector">) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    unmount = mountClaudeArtifact(App, {
      connector: CONNECTOR_NAME,
      container,
      client: createTestQueryClient(),
      locale: "en-US",
      ...extra,
    })
  })
}

/** The page's own words in English or German (its catalog). */
const en = (key: MessageKey, params?: Record<string, unknown>) => translate("en", key, params)
const de = (key: MessageKey) => translate("de", key)

/** The kit's words in English: its states, its buttons, the diagram's counts. */
const KIT = resolveUiMessages("en")
const TRY_AGAIN = KIT.common.retry
const SAME_FAILURE = KIT.sectionState.sameFailure

/** How the page words a failure: widget-shell's words with the artifact's hints and place. */
const wordsOf = (error: unknown) =>
  describePageFailure(error, "en-US", { pageHints: ARTIFACT_PAGE_HINTS })

/** A refusal of the page's connector as the page words it. */
const refusal = (code: PageErrorCode) =>
  wordsOf(new PageCallError(code, `[${code}] raw`, { connector: CONNECTOR_NAME }))

/** How the page words the recording's failure of `tool` under `fail` (`?fail=`). */
async function failureOf(fail: string[], tool: ToolName): Promise<SectionFailure> {
  const { callTool } = playRecording(fixture, { fail, tools: PAGE_TOOLS })
  const error: unknown = await createPageReader(callTool)
    .call(tool)
    .then(
      () => undefined,
      (thrown: unknown) => thrown,
    )
  if (error === undefined) throw new Error(`The recording answered ${tool}.`)
  return wordsOf(error)
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

afterEach(async () => {
  await act(async () => unmount?.())
  unmount = undefined
  document.body.replaceChildren()
  document.documentElement.lang = ""
  setFormatLocale(undefined)
  vi.unstubAllGlobals()
})

describe("the dashboard on the fixtures", () => {
  it("shows the process, its tiles, its sections and its tables, and no failure", async () => {
    await mountPage()
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
    const figures = screen.getByRole("region", { name: en("kpi.title") })
    expect(within(figures).getAllByText(en("kpi.running")).length).toBeGreaterThan(0)
    expect(screen.queryAllByRole("alert")).toEqual([])
  })

  it("makes three calls a load, each tool of PAGE_TOOLS once, and three again on Refresh, past the caches", async () => {
    const { calls } = await mountPage()
    await settled()
    expect(calls.map((call) => call.tool).sort()).toEqual([...PAGE_TOOLS].sort())
    expect(calls.every((call) => call.options.connector === undefined)).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: en("page.refresh") }))
    // The Refresh cancels what runs before it reads again: wait for its calls, not for quiet.
    await waitFor(() => {
      expect(calls).toHaveLength(6)
    })
    await settled()
    expect(calls).toHaveLength(6)
    const again = calls.slice(3)
    expect(again.map((call) => call.tool).sort()).toEqual([...PAGE_TOOLS].sort())
    expect(again.map((call) => call.options.refresh)).toEqual([true, true, true])
  })

  it("has one banner: the bar's, never a header around it", async () => {
    await mountPage()
    await settled()
    expect(document.querySelectorAll("header")).toHaveLength(1)
    expect(document.querySelectorAll("header header, header [role=banner]")).toHaveLength(0)
  })

  it("holds every id once", async () => {
    await mountPage()
    await settled()
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
  })

  it("speaks German to a German viewer", async () => {
    await mountPage({ locale: "de-DE" })
    await settled()
    expect(screen.getAllByText(de("kpi.incidents")).length).toBeGreaterThan(0)
    expect(screen.getByRole("heading", { level: 2, name: de("diagram.title") })).toBeDefined()
    expect(screen.getByRole("heading", { level: 2, name: de("outcomes.title") })).toBeDefined()
    expect(screen.getByRole("button", { name: de("page.refresh") })).toBeDefined()
  })

  it("keeps the page when one call fails: the failure in words once, Try again, the raw text under Details", async () => {
    await mountPage({ fail: ["engine_process_stats"] })
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

  it("refuses one tool with a code and keeps the rest (?fail=<tool>:<code>)", async () => {
    await mountPage({ fail: ["engine_activity_counts:unavailable"] })
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

  it("says a missing connector once, in the sections' place: the page outside an artifact", async () => {
    // The artifact runtime's own caller, as dist/app.js mounts it, where no window.claude is.
    await mountWith({})
    await settled()
    const words = refusal("not_connected")
    expectOneState(words.title)
    expect(screen.getAllByRole("button", { name: TRY_AGAIN })).toHaveLength(1)
    expect(screen.getByText(words.hint ?? "")).toBeDefined()
  })

  it("says a refusal of the connector once, as the recording gives it (?fail=needs_reauth)", async () => {
    await mountPage({ fail: ["needs_reauth"] })
    await settled()
    const words = refusal("needs_reauth")
    expectOneState(words.title)
    expect(screen.getByText(words.hint ?? "")).toBeDefined()
  })

  it("closes when one read meets a refusal of the connector, and Try again opens it", async () => {
    const refusing = new Map<string, PageErrorCode>([["engine_activity_counts", "needs_reauth"]])
    await mountPage({ refusing })
    await settled()
    expectOneState(refusal("needs_reauth").title)
    refusing.clear()
    fireEvent.click(screen.getByRole("button", { name: TRY_AGAIN }))
    await waitFor(() => {
      expect(h2s()).toEqual(SECTION_HEADINGS)
    })
    await settled()
    expect(screen.queryAllByRole("alert")).toEqual([])
  })
})

describe("the bar's freshness", () => {
  /** The stamp's whole instant, its title. */
  const stamp = () => document.querySelector('[data-slot="freshness-stamp"]')?.getAttribute("title")

  /** The fixture's answers as the server gives them after a read `ms` later than the recording. */
  const readLater =
    (ms: () => number) =>
    (_tool: string, recorded: ToolResult): ToolResult | undefined => {
      const data = recorded.structuredContent as { asOf?: string } | undefined
      if (data?.asOf === undefined) return undefined
      const asOfThen = new Date(Date.parse(data.asOf) + ms()).toISOString()
      return { ...recorded, structuredContent: { ...data, asOf: asOfThen } }
    }

  /** The oldest `asOf` of the page's answers, `ms` after the recorded ones. */
  const oldestRead = (ms = 0) =>
    formatInstant(
      new Date(Math.min(Date.parse(stats.asOf), Date.parse(counts.asOf)) + ms).toISOString(),
    )

  it("is the oldest read of the sections holding data, so a failed refresh keeps it", async () => {
    const later = 5 * 60_000
    let moved = 0
    const failing = new Set<string>()
    await mountPage({ failing, answer: readLater(() => moved) })
    await settled()
    expect(stamp()).toBe(oldestRead())

    moved = later
    failing.add("engine_process_stats")
    fireEvent.click(screen.getByRole("button", { name: en("page.refresh") }))
    await waitFor(() => {
      expect(screen.getAllByRole("alert")).toHaveLength(1)
    })
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
      const answer = (tool: string, recorded: ToolResult) => {
        if (tool !== "engine_activity_counts") return undefined
        const counts = recorded.structuredContent as ActivityCounts
        const activities = counts.activities.map((row, i) =>
          i === 0 ? { ...row, incidents: 2, incidentsInCalledInstances: 3 } : row,
        )
        return { structuredContent: { ...counts, activities } }
      }
      await mountPage({ answer })
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
    await mountPage()
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
  /** The page on the fixture, its `engine_process_stats` answer rewritten by `change`. */
  const statsAs = (change: (recorded: ProcessStats) => ProcessStats) =>
    mountPage({
      answer: (tool, recorded) =>
        tool === "engine_process_stats"
          ? { ...recorded, structuredContent: change(recorded.structuredContent as ProcessStats) }
          : undefined,
    })

  const perDay = () => screen.getByRole("region", { name: en("perDay.title") })

  // The page's own wiring, not pulse-ui's formatter: the zone the page mounts with is the one its
  // reads count days in and the one its dates render in, so a day's label is the day it counts.
  it("counts and labels the days in one zone, the one the page mounts with", async () => {
    const { calls } = await mountPage()
    await settled()
    expect(getFormatTimeZone()).toBe(fixture.timeZone)
    const perDayCall = calls.find((call) => call.tool === "engine_process_stats")
    expect(perDayCall?.args.timeZone).toBe(fixture.timeZone)
  })

  it("says the durations are of the instances that ended since the engine keeps their history", async () => {
    const since = new Date(Date.parse(stats.range.from) + 6 * 86_400_000).toISOString()
    await statsAs((s) => ({
      ...s,
      durations: { from: since, ended: 7, medianMs: 1000, p90Ms: 2000 },
    }))
    await settled()
    const scope = en("perDay.durationSince", { count: formatNumber(7), date: formatDate(since) })
    expect(within(perDay()).getByText(scope)).toBeDefined()
  })

  it("says no duration is known where the server knows none, never a duration of 0 instances", async () => {
    await statsAs((s) => ({ ...s, durations: null }))
    await settled()
    expect(within(perDay()).getByText(en("perDay.durationUnknown"))).toBeDefined()
    expect(within(perDay()).queryByText(en("perDay.durationScope", { count: "0" }))).toBeNull()
  })

  it("says an engine that writes no history leaves its counts unknown, never that none started", async () => {
    await statsAs((s) => ({
      ...s,
      history: { ...s.history, recorded: false },
      totals: { started: null, ended: null },
      buckets: s.buckets.map((b) => ({ ...b, started: null, ended: null, endedAt: {} })),
      endEvents: s.endEvents.map((event) => ({ ...event, ended: null })),
      durations: null,
    }))
    await settled()
    expect(within(perDay()).getByText(en("perDay.noHistory"))).toBeDefined()
    expect(screen.queryByText(en("perDay.empty"))).toBeNull()
    const outcomes = screen.getByRole("region", { name: en("outcomes.title") })
    expect(screen.queryByText(en("outcomes.empty"))).toBeNull()
    expect(within(outcomes).queryByText(/%/)).toBeNull()
    expect(within(outcomes).getByText(en("outcomes.noShare"))).toBeDefined()
  })
})
