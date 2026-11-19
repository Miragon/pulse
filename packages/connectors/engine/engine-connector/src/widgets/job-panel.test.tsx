// @vitest-environment happy-dom
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import type { JobPanelData } from "../view-models.js"
import { ENGINE_JOBS_DATA } from "../tool-names.js"
import { JobPanelWidget } from "./job-panel.js"
import { NavProvider, type NavIntent } from "./navigation.js"

// D3, X2, V3: the jobs list's scope is a segment, All or Without retries, each counted from the
// payload on screen in either scope; no tiles repeat the counts (one of them read the filtered
// set and claimed 0 jobs with retries left). A2: a row opens its job's instance and copies its id.

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
})

afterEach(cleanup)

const job = (id: string, retries: number): JobPanelData["jobs"][number] => ({
  id,
  processInstanceId: `pi-${id}`,
  processDefinitionKey: "invoice",
  processDefinitionId: "invoice:1:abc",
  processDefinitionName: "Invoice receipt",
  activityId: "Activity_ChargeCard",
  activityName: "Charge card",
  retries,
  exceptionMessage: retries === 0 ? "Card declined" : null,
  dueDate: null,
  suspended: false,
  priority: 0,
  createTime: "2026-06-11T08:00:00.000Z",
})

/** The page of a scope: every job of the engine is 56, of them 54 without retries. */
function page(failedOnly: boolean): JobPanelData {
  return {
    totalCount: failedOnly ? 54 : 56,
    allCount: 56,
    failedCount: 54,
    fetchedAt: "2026-10-26T08:00:00.000Z",
    jobs: failedOnly ? [job("j1", 0)] : [job("j1", 0), job("j2", 3)],
    filters: failedOnly ? { failedOnly: true } : {},
    engineId: "prod",
  }
}

/**
 * The jobs' route as the cockpit holds it: a jobs intent (the segment's) moves it to that scope,
 * every intent is recorded. The start page stays the one the route opened with, as a seed does.
 */
function Routed({ failedOnly, go }: { failedOnly: boolean; go: (intent: NavIntent) => void }) {
  const [route, setRoute] = useState(failedOnly)
  const navigate = (intent: NavIntent) => {
    go(intent)
    if (intent.type === "jobs") setRoute(intent.failedOnly === true)
  }
  return (
    <NavProvider value={navigate}>
      <JobPanelWidget data={page(failedOnly)} engine="prod" failedOnly={route} />
    </NavProvider>
  )
}

/** `hold`: the feed answers once the test lets it, so a scope's page can stay in flight. */
function renderPanel({
  failedOnly = false,
  hold,
}: { failedOnly?: boolean; hold?: Promise<void> } = {}) {
  const go = vi.fn<(intent: NavIntent) => void>()
  const calls: Array<Record<string, unknown>> = []
  const view = render(
    <TestViewHost
      tools={{
        [ENGINE_JOBS_DATA]: async (args: Record<string, unknown>) => {
          calls.push(args)
          await hold
          return page(args.failedOnly === true)
        },
      }}
    >
      <Routed failedOnly={failedOnly} go={go} />
    </TestViewHost>,
  )
  return { go, calls, ...view }
}

const scopes = () => screen.getByRole("radiogroup", { name: "Show jobs" })
const bar = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-slot='view-bar']")!

describe("the jobs' scope", () => {
  it("counts All and Without retries from the payload in either scope, no tiles", () => {
    const { container } = renderPanel({ failedOnly: true })
    const all = within(scopes()).getByRole("radio", { name: /^All/ })
    const without = within(scopes()).getByRole("radio", { name: /^Without retries/ })
    expect(all.textContent).toContain("56")
    expect(without.textContent).toContain("54")
    // The count without retries alarms by its icon, the number neutral (invariant 6).
    expect(without.querySelector("svg")).not.toBeNull()
    expect(container.querySelector("[data-slot='kpi-grid']")).toBeNull()
    expect(container.textContent).not.toMatch(/retries left/)
  })

  it("is checked by the drill to the jobs without retries, and the bar names its count alone", () => {
    const { container } = renderPanel({ failedOnly: true })
    const without = within(scopes()).getByRole("radio", { name: /^Without retries/ })
    expect(without.getAttribute("aria-checked")).toBe("true")
    expect(within(bar(container)).getByText("54 without retries")).toBeTruthy()
    expect(bar(container).textContent).not.toContain("56")
  })

  it("lists every job on a click of All, reading the feed without the filter", async () => {
    const { container, calls, go } = renderPanel({ failedOnly: true })
    fireEvent.click(within(scopes()).getByRole("radio", { name: /^All/ }))
    await waitFor(() => expect(within(bar(container)).getByText("56 total")).toBeTruthy())
    expect(calls.at(-1)).toEqual({ engine: "prod", firstResult: 0, maxResults: 50 })
    expect(screen.getAllByRole("row", { name: /^Job at Charge card/ })).toHaveLength(2)
    // The scope is the cockpit's: the segment moves the route, so its place names the scope.
    expect(go).toHaveBeenCalledWith({
      type: "jobs",
      processDefinitionKey: undefined,
      failedOnly: undefined,
    })
  })

  it("keeps its segment, focus and the page on screen while the other scope's page loads", async () => {
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const { container, calls } = renderPanel({ failedOnly: true, hold })
    const all = within(scopes()).getByRole("radio", { name: /^All/ })
    all.focus()
    fireEvent.click(all)
    await waitFor(() => expect(calls).toHaveLength(1))
    // In flight: the segment stays mounted and busy, its picked radio keeps focus, the rows stay.
    expect(scopes().getAttribute("aria-busy")).toBe("true")
    expect(document.activeElement).toBe(all)
    expect(all.getAttribute("aria-checked")).toBe("true")
    expect(within(bar(container)).getByText("54 without retries")).toBeTruthy()
    expect(screen.getAllByRole("row", { name: /^Job at Charge card/ })).toHaveLength(1)
    act(() => release())
    await waitFor(() => expect(within(bar(container)).getByText("56 total")).toBeTruthy())
    expect(scopes().getAttribute("aria-busy")).toBe("false")
    expect(document.activeElement).toBe(all)
  })

  it("asks the feed for the jobs without retries on that segment's click", async () => {
    const { calls } = renderPanel()
    fireEvent.click(within(scopes()).getByRole("radio", { name: /^Without retries/ }))
    await waitFor(() =>
      expect(calls.at(-1)).toEqual({
        engine: "prod",
        failedOnly: true,
        firstResult: 0,
        maxResults: 50,
      }),
    )
  })

  it("drops the Retries column without retries, where it holds 0 in every row", () => {
    renderPanel({ failedOnly: true })
    expect(screen.queryByRole("columnheader", { name: /^Retries/ })).toBeNull()
  })

  it("shows the feed's order on the Retries column in All: ascending, the kit's arrow", () => {
    renderPanel()
    const head = screen.getByRole("columnheader", { name: /^Retries/ })
    expect(head.getAttribute("aria-sort")).toBe("ascending")
  })

  it("says when the numbers were read at the bar's end", () => {
    const { container } = renderPanel()
    const stamp = bar(container).querySelector<HTMLElement>("[data-slot='freshness-stamp']")!
    expect(stamp.textContent).toMatch(/^As of /)
  })
})

describe("a job's row", () => {
  it("opens its instance on a click or Enter; its retry and its menu at its end open nothing", () => {
    const { go } = renderPanel({ failedOnly: true })
    const row = screen.getByRole("row", { name: "Job at Charge card, instance pi-j1" })
    fireEvent.click(within(row).getByText("Card declined"))
    fireEvent.keyDown(row, { key: "Enter" })
    fireEvent.click(within(row).getByRole("button", { name: /^More actions for the job/ }))
    expect(go.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "instance-detail", processInstanceId: "pi-j1" },
      { type: "instance-detail", processInstanceId: "pi-j1" },
    ])
  })

  it("copies its job's id on Ctrl or Cmd with C and says so", async () => {
    renderPanel({ failedOnly: true })
    fireEvent.keyDown(screen.getByRole("row", { name: /^Job at Charge card/ }), {
      key: "c",
      ctrlKey: true,
    })
    expect(await screen.findByText("Job ID copied")).toBeTruthy()
    expect(writeText).toHaveBeenCalledWith("j1")
    // A screen reader hears what the rows copy, the job's id, not the instance shown beside it.
    expect(
      screen.getByText("Enter opens the job's instance, Ctrl or Cmd+C copies its job ID."),
    ).toBeTruthy()
  })

  it("names a job without an activity by its own id", () => {
    const data = {
      ...page(true),
      jobs: [{ ...job("j9", 0), activityId: null, activityName: null }],
    }
    render(
      <TestViewHost>
        <JobPanelWidget data={data} engine="prod" failedOnly />
      </TestViewHost>,
    )
    expect(screen.getByRole("row", { name: "Job j9, instance pi-j9" })).toBeTruthy()
  })
})

describe("the jobs' route", () => {
  it("checks the scope a new route names, as the head's Jobs after the drill", async () => {
    const tools = {
      [ENGINE_JOBS_DATA]: (args: Record<string, unknown>) => page(args.failedOnly === true),
    }
    const panel = (failedOnly?: boolean) => (
      <TestViewHost tools={tools}>
        <NavProvider value={vi.fn()}>
          <JobPanelWidget data={page(failedOnly === true)} engine="prod" failedOnly={failedOnly} />
        </NavProvider>
      </TestViewHost>
    )
    const { rerender } = render(panel(true))
    expect(
      within(scopes())
        .getByRole("radio", { name: /^Without retries/ })
        .getAttribute("aria-checked"),
    ).toBe("true")
    rerender(panel(undefined))
    await waitFor(() =>
      expect(
        within(scopes()).getByRole("radio", { name: /^All/ }).getAttribute("aria-checked"),
      ).toBe("true"),
    )
  })
})
