// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { LocaleProvider, formatNumber } from "@miragon/pulse-ui"
import {
  TestViewHost,
  WebApiError,
  type HostAction,
  createTestQueryClient,
} from "@miragon/pulse-widget-shell/widgets"
import { EngineHealthVerdict, EngineHealthView } from "./engine-health.js"
import type { EngineHealthData } from "../view-models.js"
import { ENGINE_HEALTH_DATA, ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"
import { DEGRADED, HEALTHY } from "./engine-health.test-support.js"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

afterEach(() => {
  cleanup()
  queryClient = createTestQueryClient()
})

/** The fix-or-diagnose offer follows the deployment's gate: these fixtures run as `operations`. */
let tools: Record<string, unknown>
beforeAll(async () => {
  tools = { [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("operations") }
})

/** The overview's verdict on the cockpit's engine, the fixtures' `default`. */
const Widget = ({ data }: { data: EngineHealthData }) => (
  <EngineHealthVerdict data={data} engine="default" />
)

/**
 * A case renders widgets in happy-dom and waits for their queries: up to 0.2 s alone, up to 2.1 s
 * on the CI runner, where `pnpm test` runs every package's suite at once on four cores.
 */
const RENDER = { timeout: 15_000 }

describe("EngineHealthVerdict (fixture render)", RENDER, () => {
  it("renders the verdict header, KPIs and the incident clusters with drill + ask handoffs", async () => {
    render(
      <TestViewHost tools={tools} client={queryClient}>
        <Widget data={DEGRADED as never} />
      </TestViewHost>,
    )

    // Verdict header (#322 U4), the one primary next step and the AI hand-off.
    expect(screen.getByRole("heading", { name: "default · Overview" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "View incidents" })).toBeTruthy()
    expect(await screen.findByText("Assess in chat")).toBeTruthy()

    expect(screen.getByText("Running instances")).toBeTruthy()

    // One home per number: the tiles hold the counts, the bar has no facts that repeat them.
    const bar = document.querySelector<HTMLElement>('[data-slot="view-bar"]')!
    expect(bar.querySelector('[data-slot="view-bar-facts"]')).toBeNull()
    expect(bar.textContent).not.toContain("51")

    // Freshness: the bar's stamp at its end, never a fact; the cockpit's head holds the one
    // Refresh (#322 U27).
    const stamp = bar.querySelector<HTMLElement>('[data-slot="freshness-stamp"]')!
    expect(stamp.textContent).toMatch(/^As of /)
    expect(stamp.getAttribute("title")).toContain("2026")
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull()

    // Clustered incidents (cross-process, by activity + type), a row each.
    expect(screen.getByText("Top failures, grouped by cause")).toBeTruthy()
    const rows = screen.getAllByRole("row", { name: /^Failures at / })
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText("callWMS")).toBeTruthy()
    expect(within(rows[0]).getByText("Failed external task")).toBeTruthy()
    expect(within(rows[1]).getByText("checkCustomer")).toBeTruthy()

    // The row is the drill, so no "Open" whose name says another thing (WCAG 2.5.3); the guarded
    // remediation hand-off sits at each row's end.
    expect(screen.queryAllByRole("button", { name: /^Open$|^View incidents for/ })).toEqual([])
    expect(await screen.findAllByRole("button", { name: "Plan a fix in chat" })).toHaveLength(2)
  })

  it("offers the diagnosis until the widget-actions feed answers", async () => {
    // The shared client retries a failed query with backoff. Fail at once.
    queryClient.setQueryDefaults(["engine-widget-actions"], { retry: false })
    const actions: HostAction[] = []
    render(
      <TestViewHost tools={{}} onHostAction={(action) => actions.push(action)} client={queryClient}>
        <Widget data={DEGRADED as never} />
      </TestViewHost>,
    )
    fireEvent.click(await screen.findByRole("button", { name: /Assess in chat/ }))
    // Without a confirmed retry tool the clusters offer the diagnosis.
    expect(await screen.findAllByRole("button", { name: /Explain error in chat/ })).toHaveLength(2)
    const prompts = actions.flatMap((a) => (a.type === "sendFollowUp" ? [a.prompt] : []))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Ids: engine="default"')
    expect(prompts[0]).not.toMatch(/\bengine_[a-z0-9_]+/)
    queryClient.setQueryDefaults(["engine-widget-actions"], {})
  })

  // #322 U12: names before ids, the cause as the sub-line.
  it("a stable engine's badge is the table's healthy: neutral, never green", () => {
    render(
      <TestViewHost client={queryClient}>
        <Widget data={HEALTHY as never} />
      </TestViewHost>,
    )
    const badge = screen.getByText("Stable").closest("[data-slot='status-badge']")!
    expect(badge.getAttribute("data-tone")).toBe("neutral")
  })

  it("an engine with nothing deployed is neutral: no green 'stable' over an empty engine", () => {
    const empty: EngineHealthData = {
      ...HEALTHY,
      summary: { ...HEALTHY.summary, runningInstances: 0, totalDefinitions: 0 },
    }
    render(
      <TestViewHost client={queryClient}>
        <Widget data={empty as never} />
      </TestViewHost>,
    )
    const badge = screen.getByText("Empty").closest("[data-slot='status-badge']")!
    expect(badge.getAttribute("data-tone")).toBe("neutral")
    // No open incidents: no primary to look at them.
    expect(screen.queryByRole("button", { name: "View incidents" })).toBeNull()
  })

  it("renders the stable verdict with no cluster list when there are no incidents", () => {
    render(
      <TestViewHost client={queryClient}>
        <Widget data={HEALTHY as never} />
      </TestViewHost>,
    )

    expect(screen.queryByText("Top failures, grouped by cause")).toBeNull()

    // The healthy state still earns the screen: the day's started and completed instances, one
    // name for them, never the flow's "Throughput".
    expect(screen.getByText(/^Started and completed \(24h\):/)).toBeTruthy()
    expect(screen.getByText(`${formatNumber(1240)} · ${formatNumber(1180)}`)).toBeTruthy()
  })

  it("shows an unread started or completed count as —, never 0", () => {
    render(
      <TestViewHost client={queryClient}>
        <Widget data={{ ...HEALTHY, summary: { ...HEALTHY.summary, completed24h: null } }} />
      </TestViewHost>,
    )
    expect(screen.getByText(`${formatNumber(1240)} · —`)).toBeTruthy()
  })

  it("names the incidents growth as new in the last hour, no day's count and no denominator", () => {
    const { unmount } = render(
      <TestViewHost client={queryClient}>
        <Widget data={DEGRADED} />
      </TestViewHost>,
    )
    expect(screen.getByText("(9 new in the last hour)", { exact: false })).toBeTruthy()
    // The deployed count is the processes section's: "Affected processes 2", never "2 /8".
    expect(document.body.textContent).not.toMatch(/\/\s?8\b/)
    // Camunda 7 counts no root incidents in a day: no window of 24h, in the tile or the causes.
    expect(document.body.textContent).not.toMatch(/new in 24h/i)
    unmount()
    // None in the last hour, or a scan that does not reach back an hour: the tile says no growth.
    for (const lastHourIncidents of [0, null]) {
      const { unmount: close } = render(
        <TestViewHost client={queryClient}>
          <Widget data={{ ...DEGRADED, summary: { ...DEGRADED.summary, lastHourIncidents } }} />
        </TestViewHost>,
      )
      expect(screen.queryByText(/new in/)).toBeNull()
      close()
    }
  })
})

/** The verdict travels as data and the widget words it in the view's language (#322 U3). */
describe("the verdict line and the hand-offs speak the view's language", RENDER, () => {
  function renderIn(locale: string, data: EngineHealthData) {
    return render(
      <LocaleProvider locale={locale}>
        <TestViewHost tools={tools} client={queryClient}>
          <Widget data={data as never} />
        </TestViewHost>
      </LocaleProvider>,
    )
  }

  const EMPTY_ENGINE: EngineHealthData = {
    ...HEALTHY,
    summary: { ...HEALTHY.summary, runningInstances: 0, totalDefinitions: 0 },
  }

  // The verdict line is gone with its counts (one home per number): the badge says the verdict,
  // the tiles the counts, in either language and on every verdict.
  it.each([
    ["en", DEGRADED],
    ["de", DEGRADED],
    ["en", HEALTHY],
    ["de", HEALTHY],
    ["en", EMPTY_ENGINE],
    ["de", EMPTY_ENGINE],
  ] as const)("%s: the bar repeats no count of the tiles", (locale, data) => {
    renderIn(locale, data)
    const bar = document.querySelector<HTMLElement>('[data-slot="view-bar"]')!
    expect(bar.querySelector('[data-slot="view-bar-facts"]')).toBeNull()
    expect(bar.textContent).not.toMatch(/\b(51|312)\b/)
  })

  it("a German view names the window as the cluster's tiles do", () => {
    renderIn("de", DEGRADED)
    expect(screen.getByText("(9 neu in der letzten Stunde)", { exact: false })).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/neu in 24 Std\./i)
    expect(screen.getByText(/^Gestartet und abgeschlossen \(24 Std\.\):/)).toBeTruthy()
  })

  it("a German view: German title, verdict, status badge and chat hand-offs, no English left", async () => {
    const { container } = renderIn("de", DEGRADED)
    expect(screen.getByRole("heading", { name: "default · Übersicht" })).toBeTruthy()
    expect(screen.getByText("Beeinträchtigt")).toBeTruthy()
    // The hand-offs name the chat and draw the icon of their function.
    const assess = await screen.findByRole("button", { name: "Im Chat bewerten" })
    expect(assess.querySelector("svg")!.getAttribute("class")).toContain("lucide-list-checks")
    const fixes = await screen.findAllByRole("button", { name: "Behebung im Chat planen" })
    expect(fixes).toHaveLength(2)
    expect(fixes[0].querySelector("svg")!.getAttribute("class")).toContain("lucide-wrench")
    for (const english of ["Engine overview", "open incidents", "Degraded", "Assess", "Refresh"]) {
      expect(container.textContent).not.toContain(english)
    }
    // No glyph icon and no sparkle anywhere in the view.
    expect(container.textContent).not.toMatch(/[✦↻⚠▶›]/)
  })

  it("a read-only deployment explains the cluster instead of planning a fix", async () => {
    render(
      <LocaleProvider locale="de">
        <TestViewHost
          tools={{ [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("read-only") }}
          client={queryClient}
        >
          <Widget data={DEGRADED as never} />
        </TestViewHost>
      </LocaleProvider>,
    )
    const explain = await screen.findAllByRole("button", { name: "Fehler im Chat erklären" })
    expect(explain).toHaveLength(2)
    expect(explain[0].querySelector("svg")!.getAttribute("class")).toContain("lucide-file-search")
    expect(screen.queryByRole("button", { name: "Behebung im Chat planen" })).toBeNull()
  })
})

/**
 * The chat can look for why an engine does not answer, and a retry may reach it; a refused
 * profile's reason is on screen, and neither helps until the operator fixes the profile.
 */
describe("an engine whose health cannot be read", RENDER, () => {
  const REFUSED =
    '[ENGINE_PROFILE_REFUSED] Engine "default" is configured, but its profile cannot be used: auth.tokenEnv names a variable that is not set. Ask whoever runs this server to fix it.'

  it.each([
    ["an unreachable engine offers Try again and the chat", "engine default unreachable", true],
    ["a refused profile offers neither: only the operator can fix it", REFUSED, false],
  ])("%s", async (_case, message, offered) => {
    const failing = () => Promise.reject(new Error(message))
    render(
      <TestViewHost tools={{ ...tools, [ENGINE_HEALTH_DATA]: failing }} client={queryClient}>
        <EngineHealthView engine="default" />
      </TestViewHost>,
    )
    await screen.findByRole("alert")
    expect(screen.queryByRole("button", { name: "Try again" }) !== null).toBe(offered)
    expect(screen.queryByRole("button", { name: "Find cause in chat" }) !== null).toBe(offered)
  })

  /** F2: an engine that refused the server's login runs, so the chat never looks for an outage. */
  it.each([
    [
      "a 401 asks why the engine refused the server's login",
      "[401] empty response body (engine default). The engine rejected the configured credentials.",
      "The engine refused the server's login.",
      "not reachable",
    ],
    [
      "a 403 asks the same",
      "[403 AuthorizationException] The user 'pulse' does not have READ permission (engine default)",
      "The engine refused the server's login.",
      "not reachable",
    ],
    [
      "an unreachable engine asks why it is not reachable",
      "engine default unreachable",
      "Find out why the engine is not reachable",
      "refused the server's login",
    ],
  ])("%s", async (_case, message, intent, absent) => {
    const failing = () => Promise.reject(new Error(message))
    const actions: HostAction[] = []
    render(
      <TestViewHost
        tools={{ ...tools, [ENGINE_HEALTH_DATA]: failing }}
        onHostAction={(action) => actions.push(action)}
        client={queryClient}
      >
        <EngineHealthView engine="default" />
      </TestViewHost>,
    )
    fireEvent.click(await screen.findByRole("button", { name: "Find cause in chat" }))
    const prompts = actions.flatMap((a) => (a.type === "sendFollowUp" ? [a.prompt] : []))
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain(intent)
    expect(prompts[0]).not.toContain(absent)
  })

  it.each([
    ["an unreachable engine's failed re-pull offers Try again", "engine default unreachable", true],
    ["a refused profile's failed re-pull offers none", REFUSED, false],
  ])("%s", async (_case, message, offered) => {
    const failing = () => Promise.reject(new Error(message))
    render(
      <TestViewHost tools={{ ...tools, [ENGINE_HEALTH_DATA]: failing }} client={queryClient}>
        <EngineHealthView data={DEGRADED} engine="default" />
      </TestViewHost>,
    )
    await act(() => queryClient.invalidateQueries({ queryKey: ["engine:health"] }))
    // The kit's strip docked under the view's bar, a warning said politely.
    const strip = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-slot="status-strip"]')
      if (!found) throw new Error("no status strip yet")
      return found
    })
    const bar = document.querySelector('[data-slot="view-bar"]')!
    expect(bar.nextElementSibling).toBe(strip)
    expect(strip.getAttribute("data-tone")).toBe("warning")
    expect(within(strip).getByRole("status").textContent).toContain("This overview is not current")
    expect(within(strip).getByRole("status").textContent).not.toContain(message)
    expect(within(strip).queryByRole("button", { name: "Try again" }) !== null).toBe(offered)
    // The engine's own text waits under the strip's Details.
    const reason = within(strip).getByText(message)
    expect(reason.hidden).toBe(true)
    fireEvent.click(within(strip).getByRole("button", { name: "Details" }))
    expect(reason.hidden).toBe(false)
  })

  it("leaves a page's ended session to the page's frame: the verdict stays, no strip", async () => {
    const ended = () => Promise.reject(new WebApiError(401, { code: "signed_out", message: "x" }))
    render(
      <TestViewHost tools={{ ...tools, [ENGINE_HEALTH_DATA]: ended }} client={queryClient}>
        <EngineHealthView data={DEGRADED} engine="default" />
      </TestViewHost>,
    )
    await act(() => queryClient.invalidateQueries({ queryKey: ["engine:health"] }))
    const key = ["engine:health", "default", { engine: "default" }]
    await waitFor(() => expect(queryClient.getQueryState(key)?.status).toBe("error"))
    expect(document.querySelector('[data-slot="status-strip"]')).toBeNull()
    expect(document.querySelector('[data-slot="view-bar"]')).toBeTruthy()
  })
})
