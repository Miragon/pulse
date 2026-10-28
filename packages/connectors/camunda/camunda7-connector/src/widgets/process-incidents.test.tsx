// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, render, screen, within } from "@testing-library/react"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { ProcessDefinitionKpi } from "./process-incidents/kpi.js"
import { diagramActivityFraction } from "./process-incidents/activity-scope.js"
import type { ProcessIncidentsData } from "../view-models.js"

afterEach(cleanup)

// #335 N60: `activities` spans every version, the diagram is the latest, so an older-only activity
// must stay out of "X of Y".
const DATA: ProcessIncidentsData = {
  processDefinitionKey: "leasing",
  processDefinitionName: "Leasing",
  diagramVersion: 2,
  diagramDefinitionId: null,
  cockpitUrl: null,
  runningInstances: 99,
  incidentCount: 3,
  last24hCount: 1,
  failedJobs: 2,
  totalActivityCount: 2,
  affectedDiagramActivityCount: 1,
  latestIncident: "2026-10-10T12:00:00.000+0000",
  activities: [
    {
      activityId: "assess",
      activityName: "Assess creditworthiness",
      representativeMessage: "assess failed",
      incidentCount: 2,
      firstSeen: null,
      latestIncident: "2026-10-10T12:00:00.000+0000",
    },
    {
      // Retired in v2: it has incidents, but no shape in the diagram.
      activityId: "oldTask",
      activityName: null,
      representativeMessage: "oldTask failed",
      incidentCount: 1,
      firstSeen: null,
      latestIncident: "2026-10-10T11:00:00.000+0000",
    },
  ],
  siblingsWithIncidents: null,
  engineVendor: "CIB seven",
  engineId: "prod-a",
}

const Kpi = ProcessDefinitionKpi as unknown as ComponentType<Record<string, unknown>>

describe("definition view — activities affected over the diagram", () => {
  it("counts only the diagram's activities in the fraction and names the older-version ones beside it", () => {
    render(<WidgetFixtureHost widget={Kpi} data={DATA as unknown as Record<string, unknown>} />)

    const cell = screen
      .getByText("Activities affected")
      .closest<HTMLElement>('[data-slot="kpi-strip"] > div > *')!
    expect(within(cell).getByText("1")).toBeTruthy()
    expect(within(cell).getByText("/2")).toBeTruthy()
    expect(within(cell).getByText("+1 only in older versions")).toBeTruthy()
    expect(within(cell).queryByText("2")).toBeNull()
  })

  it("keeps the key-wide count without a diagram, with no fraction to mix scopes into", () => {
    expect(
      diagramActivityFraction({
        ...DATA,
        totalActivityCount: null,
        affectedDiagramActivityCount: null,
      }),
    ).toBeNull()
    expect(diagramActivityFraction(DATA)).toEqual({ affected: 1, total: 2, olderVersionsOnly: 1 })
  })
})
