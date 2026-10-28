// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { LocaleProvider, queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import type { CockpitDashboardData } from "../view-models.js"
import { ProcessDefinitionsTable } from "./cockpit-dashboard/definitions-table.js"

// #322 U14, decision f: camunda7 reads the kit's `countTone`, the ladder analytics uses in the landscape this cockpit embeds.

afterEach(() => {
  cleanup()
  queryClient.clear()
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

describe("the definitions table's jobs without retries", () => {
  it("edges them in danger while there are any and leaves a zero neutral", () => {
    render(
      <LocaleProvider locale="en">
        <WidgetFixtureHost widget={() => <ProcessDefinitionsTable data={LANDSCAPE} />} data={{}} />
      </LocaleProvider>,
    )
    const table = screen.getByRole("table")
    const broken = within(table).getByText("BROKEN").closest("tr")!
    expect(within(broken).getByText("7").className).toContain("border-danger")
    expect(within(broken).getByText("3").className).toContain("border-danger")
    const calm = within(table).getByText("CALM").closest("tr")!
    for (const zero of within(calm).getAllByText("0")) {
      expect(zero.className).not.toContain("border-danger")
    }
  })
})
