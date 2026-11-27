// @vitest-environment happy-dom
/**
 * The overview's root incidents outside any process (owner decision of 2026-11-26): a batch's or
 * the history cleanup's failed job, which no process counts and the verdict judges, shows as a
 * line of its own under the bar, never summed into the tile of open incidents, which then names
 * the processes' alone; a lower bound where the scan stopped; named in the view's context.
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import { EngineHealthVerdict } from "./engine-health.js"
import type { EngineHealthData } from "../view-models.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"
import { HEALTHY } from "./engine-health.test-support.js"

afterEach(cleanup)

let tools: Record<string, unknown>
beforeAll(async () => {
  tools = { [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("operations") }
})

/** A degraded engine whose processes hold no open incident: the history cleanup's job failed. */
function outside(count: number, atLeast = false): EngineHealthData {
  return {
    ...HEALTHY,
    status: "warning",
    summary: { ...HEALTHY.summary, outsideAnyProcess: { count, atLeast } },
  }
}

function renderOverview(data: EngineHealthData, locale = "en") {
  const contexts: string[] = []
  render(
    <LocaleProvider locale={locale}>
      <TestViewHost
        tools={tools}
        client={createTestQueryClient()}
        onModelContext={(text) => contexts.push(text)}
      >
        <EngineHealthVerdict data={data} engine="default" />
      </TestViewHost>
    </LocaleProvider>,
  )
  return contexts
}

const line = () => document.querySelector<HTMLElement>('[data-part="outside-any-process"]')

describe("the overview's root incidents outside any process", { timeout: 15_000 }, () => {
  it("shows them as a line of their own beside 0 open incidents in processes", () => {
    const contexts = renderOverview(outside(1))
    expect(screen.getByText("Degraded")).toBeTruthy()
    expect(line()?.textContent).toContain("1 incident outside any process")
    expect(line()?.textContent).toContain("No process counts it, the engine's state does.")
    // The tile counts the processes' alone, and says so.
    expect(screen.getByText("Open incidents in processes")).toBeTruthy()
    expect(screen.queryByText("Open incidents")).toBeNull()
    expect(contexts.at(-1)).toContain("openRootIncidents=0, rootIncidentsOutsideAnyProcess=1")
  })

  it("gives a lower bound where the scan stopped, in the view's context too", () => {
    const contexts = renderOverview(outside(2000, true))
    expect(line()?.textContent).toContain("2,000 incidents outside any process")
    expect(line()?.textContent).toContain("There may be more")
    expect(contexts.at(-1)).toContain("rootIncidentsOutsideAnyProcessAtLeast=2000")
    expect(contexts.at(-1)).not.toContain("rootIncidentsOutsideAnyProcess=")
  })

  it("words them in German", () => {
    renderOverview(outside(1), "de")
    expect(line()?.textContent).toContain("1 Incident außerhalb von Prozessen")
    expect(screen.getByText("Offene Incidents in Prozessen")).toBeTruthy()
  })

  // A payload of a server before the count (a rolling deploy, a stored result) carries none.
  it("takes a summary without the count as none: no line, the tile's label, no fact", () => {
    const before = { ...outside(1).summary }
    delete before.outsideAnyProcess
    const contexts = renderOverview({ ...outside(1), summary: before })
    expect(screen.getByText("Degraded")).toBeTruthy()
    expect(line()).toBeNull()
    expect(screen.getByText("Open incidents")).toBeTruthy()
    expect(contexts.at(-1)).not.toContain("OutsideAnyProcess")
  })

  it("shows no line and keeps the tile's label where none stands outside any process", () => {
    const contexts = renderOverview(HEALTHY)
    expect(line()).toBeNull()
    expect(screen.getByText("Open incidents")).toBeTruthy()
    expect(contexts.at(-1)).not.toContain("OutsideAnyProcess")
  })
})
