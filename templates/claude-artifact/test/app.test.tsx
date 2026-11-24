// @vitest-environment happy-dom
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { formatInstant, LocaleProvider } from "@miragon/pulse-ui"
import { setFormatLocale } from "@miragon/pulse-ui/format"
import { afterEach, describe, expect, it, vi } from "vitest"
import { type Fixture, mockClaude } from "../fixtures/mock-claude.ts"
import { Page, PROCESS_KEY } from "../src/app.tsx"
import { claudeConnector } from "../src/engine/claude-connector.ts"
import { EngineError, type Connector, type ToolResult } from "../src/engine/connector.ts"
import { callKey } from "../src/engine/engine.ts"
import { translate } from "../src/messages.ts"
import { CutNote } from "../src/sections/cut-note.tsx"
import { countTargets } from "../src/sections/diagram.tsx"
import { goTo } from "../src/sections/names.ts"
import { ElementBadges } from "../src/temporary/process-diagram.tsx"

/**
 * The page over the recorded fixtures, through the page's own connector: its structure and its
 * states, not its numbers, which change with every recording. bpmn-js may fail to draw in
 * happy-dom; the diagram's frame says so then, and the test reads around it (the badges' own
 * component and their targets are held apart).
 */

const fixture = JSON.parse(
  readFileSync(join(import.meta.dirname, `../fixtures/${PROCESS_KEY}.json`), "utf8"),
) as Fixture
const asOf = new Date(fixture.asOf)

function renderPage(language: string, fail: string[] = []) {
  const connector = claudeConnector(mockClaude(fixture, { fail }))
  return render(<Page connector={connector} language={language} now={() => asOf} />)
}

/** An error result as the server sends one, the same text for every tool it hits. */
function failed(tool: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `[503 ServiceUnavailable] ${tool} failed (engine prod-a)` }],
  }
}

/** The arguments that carry a time window: the page reads them from its clock. */
const WINDOWS = new Set(["startedAfter", "startedBefore", "finishedAfter", "finishedBefore"])

/** A call's key with its time windows aside, so the fixture answers on a later clock too. */
function timelessKey(tool: string, args: Record<string, unknown>): string {
  return callKey(
    tool,
    Object.fromEntries(Object.entries(args).map(([k, v]) => [k, WINDOWS.has(k) ? "*" : v])),
  )
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
    fixture.calls.map((call) => [timelessKey(call.tool, call.arguments), call.result]),
  )
  return {
    callTool(name, args) {
      const code = options.throwing?.get(name)
      if (code !== undefined) return Promise.reject(new EngineError(code, name, `[${code}] raw`))
      if (options.failing?.has(name)) return Promise.resolve(failed(name))
      const recorded = answers.get(timelessKey(name, args))
      const result = options.answer?.(name, recorded) ?? recorded
      return Promise.resolve(result ?? failed(`unrecorded ${name}`))
    },
  }
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

const SECTION_HEADINGS = [
  "Diagram",
  "Started and ended per day",
  "End events reached",
  "Open incidents by activity",
  "Open tasks",
]

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
    for (const label of [
      "Running instances",
      "Open incidents",
      "With incident",
      "Jobs without retries",
      "Open tasks",
      "Started",
      "Ended",
    ]) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    expect(
      screen.getByRole("table", { name: "Instances started and ended per day, last 14 days" }),
    ).toBeDefined()
    expect(screen.getByRole("list", { name: /end events reached/i })).toBeDefined()
    expect(screen.getByText(/shares are of all .* end events reached/)).toBeDefined()
    const incidents = screen.getByRole("region", { name: "Open incidents by activity" })
    expect(within(incidents).getAllByRole("table").length).toBeGreaterThan(0)
    expect(screen.queryAllByRole("alert")).toEqual([])
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
    expect(screen.getAllByText("Offene Incidents").length).toBeGreaterThan(0)
    expect(screen.getByRole("heading", { level: 2, name: "Diagramm" })).toBeDefined()
    expect(screen.getByRole("heading", { level: 2, name: "Erreichte Endereignisse" })).toBeDefined()
    expect(screen.getByRole("button", { name: "Aktualisieren" })).toBeDefined()
  })

  it("keeps the page when one section fails: the failure in words, Try again, the raw text under Details", async () => {
    renderPage("en-US", ["engine_status"])
    await settled()
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("unreachable")
    expect(within(alert).getByRole("button", { name: /Try again/ })).toBeDefined()
    expect(alert.textContent).toContain("Details")
    expect(screen.queryByText("Running instances")).toBeNull()
    expect(screen.getByRole("heading", { level: 2, name: "Open tasks" })).toBeDefined()
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0)
  })
})

describe("a page the runtime refuses as a whole", () => {
  /** The page's one state: one alert under the bar, no section, the bar without a strip. */
  function expectOneState(title: string) {
    expect(screen.getAllByText(title)).toHaveLength(1)
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(h2s()).toEqual([title])
    expect(screen.queryAllByRole("table")).toEqual([])
    expect(document.querySelector('[data-slot="status-strip"]')).toBeNull()
    expect(document.querySelector('[data-slot="freshness-stamp"]')).toBeNull()
    expect(within(screen.getByRole("main")).getByRole("alert").textContent).toContain(title)
  }

  it("says a missing connector once, in the sections' place", async () => {
    render(<Page connector={claudeConnector(undefined)} language="en-US" now={() => asOf} />)
    await settled()
    expectOneState("This page has no Pulse connector")
    expect(screen.getAllByRole("button", { name: /Try again/ })).toHaveLength(1)
    expect(screen.getByText(/then try again/)).toBeDefined()
  })

  it("says a refusal of the runtime once, as the mock gives it (?fail=needs_reauth)", async () => {
    renderPage("en-US", ["needs_reauth"])
    await settled()
    expectOneState("Your Pulse connector needs a new sign-in")
    expect(screen.getByText(/in Settings under Connectors/)).toBeDefined()
  })

  it("says an engine it cannot resolve once, and Try again mounts the sections", async () => {
    const failing = new Set(["engine_list_engines"])
    render(<Page connector={steered({ failing })} language="en-US" now={() => asOf} />)
    await settled()
    const state = within(screen.getByRole("main")).getByRole("alert")
    expect(state.textContent).toContain("unreachable")
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(h2s()).toHaveLength(1)
    failing.clear()
    fireEvent.click(within(state).getByRole("button", { name: /Try again/ }))
    await waitFor(() => {
      expect(h2s()).toEqual(SECTION_HEADINGS)
    })
    await settled()
    expect(screen.queryAllByRole("alert")).toEqual([])
  })

  it.each(["engine_status", "engine_list_process_definitions"])(
    "closes the page when a read past the engine meets a refusal of the connector (%s)",
    async (tool) => {
      const throwing = new Map([[tool, "needs_reauth" as const]])
      render(<Page connector={steered({ throwing })} language="en-US" now={() => asOf} />)
      await settled()
      expectOneState("Your Pulse connector needs a new sign-in")
    },
  )

  it("offers no Try again when the page may not resolve its engine", async () => {
    const throwing = new Map([["engine_list_engines", "not_allowed" as const]])
    render(<Page connector={steered({ throwing })} language="en-US" now={() => asOf} />)
    await settled()
    expectOneState("This page may not call the tool it needs")
    expect(screen.queryAllByRole("button", { name: /Try again/ })).toEqual([])
  })
})

describe("sections that fail alike", () => {
  it("say it once: the first section in full, the next only that it was not read", async () => {
    const failing = new Set(["engine_list_incidents"])
    render(<Page connector={steered({ failing })} language="en-US" now={() => asOf} />)
    await settled()
    const alerts = screen.getAllByRole("alert")
    expect(alerts).toHaveLength(1)
    const diagram = screen.getByRole("region", { name: /Diagram/ })
    expect(within(diagram).getByRole("alert")).toBe(alerts[0])
    const incidents = screen.getByRole("region", { name: "Open incidents by activity" })
    expect(within(incidents).getByText("Not read, for the same reason as above.")).toBeDefined()
    expect(screen.getAllByRole("button", { name: /Try again/ })).toHaveLength(1)
    failing.clear()
    fireEvent.click(within(alerts[0]).getByRole("button", { name: /Try again/ }))
    await waitFor(() => {
      expect(screen.queryAllByRole("alert")).toEqual([])
    })
    expect(screen.queryByText("Not read, for the same reason as above.")).toBeNull()
    expect(within(incidents).getAllByRole("table").length).toBeGreaterThan(0)
  })

  it("say it once under the bar when the bar's own read fails alike", async () => {
    const failing = new Set(["engine_get_process_definition_xml"])
    render(<Page connector={steered({ failing })} language="en-US" now={() => asOf} />)
    await settled()
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(document.querySelectorAll('[data-slot="status-strip"]')).toHaveLength(1)
    // The diagram, the end events, the incidents and the tasks read the process as the bar does.
    expect(screen.getAllByText("Not read, for the same reason as above.")).toHaveLength(4)
    expect(screen.getByText("Running instances")).toBeDefined()
  })
})

describe("the bar's freshness", () => {
  /** The stamp's whole instant, its title. */
  const stamp = () => document.querySelector('[data-slot="freshness-stamp"]')?.getAttribute("title")

  it("shows the oldest read of the sections holding data, so a failed refresh keeps it", async () => {
    let clock = asOf
    const later = new Date(asOf.getTime() + 5 * 60_000)
    const failing = new Set<string>()
    render(<Page connector={steered({ failing })} language="en-US" now={() => clock} />)
    await settled()
    expect(stamp()).toBe(formatInstant(asOf.toISOString()))

    clock = later
    failing.add("engine_status")
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await settled()
    expect(screen.getAllByRole("alert")).toHaveLength(1)
    expect(screen.getByText("Running instances")).toBeDefined()
    expect(stamp()).toBe(formatInstant(asOf.toISOString()))

    failing.clear()
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => {
      expect(screen.queryAllByRole("alert")).toEqual([])
    })
    await settled()
    expect(stamp()).toBe(formatInstant(later.toISOString()))
  })
})

describe("a section whose reads are cut", () => {
  it.each([
    ["cap", "Only the first 1,000 rows were read, so the counts here may be too low."],
    [
      "changed",
      "The list changed while the page read it, so the counts here may be too low. Refresh reads it again.",
    ],
    [null, ""],
  ] as const)("says why its counts may be too low (%s)", (cut, words) => {
    const { container } = render(
      <LocaleProvider locale="en" translator={translate}>
        <CutNote cut={cut} />
      </LocaleProvider>,
    )
    expect(container.textContent).toBe(words)
  })
})

describe("the incidents' anchors", () => {
  it("hold an activity's own row and its called line apart when it has both", async () => {
    const answer = (tool: string, recorded: ToolResult | undefined) => {
      if (tool !== "engine_list_incidents" || recorded === undefined) return undefined
      const list = recorded.structuredContent as { items: { id: string; activityId: string }[] }
      const copy = list.items.find((incident) => incident.activityId !== null)
      if (copy === undefined) return undefined
      const own = { ...copy, id: "own-root", causeIncidentId: null, rootCauseIncidentId: null }
      const items = [...list.items, own]
      return { structuredContent: { ...list, items, totalCount: items.length } }
    }
    render(<Page connector={steered({ answer })} language="en-US" now={() => asOf} />)
    await settled()
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
    const both = ids.filter((id) => id.startsWith("incidents-row-"))
    expect(both.length).toBeGreaterThan(0)
    const called = both.map((id) => id.replace("incidents-row-", "calledIncidents-row-"))
    expect(called.some((id) => ids.includes(id))).toBe(true)
  })
})

describe("a count on the diagram", () => {
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

  function renderBadges(
    badge: { running: number; incidents: number; incidentsInCalledInstances: number },
    selectable: (kind: string) => boolean,
  ) {
    const onSelect = vi.fn()
    render(
      <LocaleProvider locale="en" translator={translate}>
        <ElementBadges
          badge={{ elementId: "Activity_Assess", ...badge }}
          elementName="Assess"
          selectable={selectable}
          onSelect={onSelect}
        />
      </LocaleProvider>,
    )
    return onSelect
  }

  it("is a button only where it leads somewhere, else the same badge with its words", () => {
    const onSelect = renderBadges(
      { running: 54, incidents: 0, incidentsInCalledInstances: 3 },
      (kind) => kind !== "running",
    )
    const buttons = screen.getAllByRole("button")
    expect(buttons).toHaveLength(1)
    expect(buttons[0].getAttribute("aria-label")).toContain("3 incidents in called instances")
    expect(screen.getByText("Assess: 54 instances running")).toBeDefined()
    const plain = document.querySelector('[data-part="badge-plain"]')
    expect(plain?.querySelector('[data-kind="running"]')).not.toBeNull()
    expect(plain?.closest("button")).toBeNull()
    fireEvent.click(buttons[0])
    expect(onSelect).toHaveBeenCalledWith("incidentsInCalledInstances")
  })

  it("names the kind clicked where both kinds of incidents share a scope", () => {
    const onSelect = renderBadges(
      { running: 0, incidents: 2, incidentsInCalledInstances: 3 },
      () => true,
    )
    const [own, called] = screen.getAllByRole("button")
    fireEvent.click(called)
    expect(onSelect).toHaveBeenLastCalledWith("incidentsInCalledInstances")
    fireEvent.click(own)
    expect(onSelect).toHaveBeenLastCalledWith("incidents")
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
