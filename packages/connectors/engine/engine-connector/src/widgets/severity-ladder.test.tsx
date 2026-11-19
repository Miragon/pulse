// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { LocaleProvider } from "@miragon/pulse-ui"
import type { CockpitDashboardData } from "../view-models.js"
import { ProcessDefinitionsTable } from "./cockpit-dashboard/definitions-table.js"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"

// #322 U14, decision f, and owner decision (d) of D9: a count stays a neutral number; jobs without
// retries and open incidents alarm while there are any, by the tone's icon of its own shape and
// words for a screen reader, as the cross-engine landscape shows them too.

afterEach(() => {
  cleanup()
})

const row = (key: string, failedJobs: number, incidentCount: number) => ({
  id: `${key}:1:d`,
  key,
  name: key.toUpperCase(),
  latestVersion: 1,
  instances: 4,
  failedJobs,
  incidents: incidentCount ? [{ incidentType: "failedJob", incidentCount }] : [],
})

const LANDSCAPE: CockpitDashboardData = {
  summary: { totalDefinitions: 2, totalRunningInstances: 8, totalFailedJobs: 7, totalIncidents: 3 },
  definitions: [row("broken", 7, 3), row("calm", 0, 0)],
  engineId: "prod-a",
}

const TONE_AS_TEXT = /\btext-(?:success|warning|danger|info)(?:-ink)?\b|\b(?:bg|border)-danger/

describe("the definitions table's jobs without retries and open incidents", () => {
  it("mark them with the danger icon and words while there are any and leave a zero plain", () => {
    render(
      <LocaleProvider locale="en">
        <TestViewHost>
          <ProcessDefinitionsTable data={LANDSCAPE} engine="prod-a" />
        </TestViewHost>
      </LocaleProvider>,
    )
    const table = screen.getByRole("table")
    const broken = within(table).getByText("BROKEN").closest("tr")!
    const figure = (cell: HTMLElement) => cell.closest('[data-slot="count-figure"]')!
    const jobs = figure(within(broken).getByText("7"))
    expect(jobs.getAttribute("data-tone")).toBe("danger")
    expect(jobs.querySelector("svg")?.getAttribute("class")).toContain("lucide-circle-x")
    expect(jobs.textContent).toBe("7Has jobs without retries")
    const incidents = figure(within(broken).getByText("3"))
    expect(incidents.textContent).toBe("3Has open incidents")
    // The numbers themselves stay neutral: no tone on their text, tint or edge.
    for (const cell of [jobs, incidents]) {
      expect(cell.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, "")).not.toMatch(TONE_AS_TEXT)
    }
    const calm = within(table).getByText("CALM").closest("tr")!
    for (const zero of within(calm).getAllByText("0")) {
      expect(figure(zero).getAttribute("data-tone")).toBe("neutral")
      expect(figure(zero).querySelector("svg")).toBeNull()
    }
  })
})
