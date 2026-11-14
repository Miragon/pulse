// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { TONE_DOT, TONE_ICON } from "@miragon/pulse-ui"
import { ProcessDefinitionKpi } from "./process-incidents/kpi.js"
import { ActivityIncidentList } from "./process-incidents/list.js"
import { diagramActivityFraction } from "./process-incidents/activity-scope.js"
import type { ProcessIncidentsData } from "../view-models.js"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"

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

/** The process detail's KPI strip on the route's process and engine. */
const Kpi = ({ data }: { data: ProcessIncidentsData }) => (
  <ProcessDefinitionKpi data={data} processDefinitionKey="leasing" engine="prod-a" />
)

describe("definition view: activities affected over the diagram", () => {
  it("counts only the diagram's activities in the fraction and names the older-version ones beside it", () => {
    render(
      <TestViewHost>
        <Kpi data={DATA as never} />
      </TestViewHost>,
    )

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

// A process that runs without a problem is neutral (SITUATION_TONES, invariant 6): no green dot or
// check, the kit's empty note, in both empty states of the incidents list.
describe("definition view: a process without open incidents", () => {
  const QUIET: ProcessIncidentsData = {
    ...DATA,
    incidentCount: 0,
    last24hCount: 0,
    failedJobs: 0,
    affectedDiagramActivityCount: 0,
    activities: [],
    siblingsWithIncidents: [
      { processDefinitionKey: "order", processDefinitionName: "Order", incidentCount: 4 },
    ],
  }
  const SUCCESS = [TONE_DOT.success, TONE_ICON.success]

  it.each(["note", "siblings"] as const)("%s: the kit's neutral empty note", (emptyVariant) => {
    const { container } = render(
      <TestViewHost>
        <ActivityIncidentList
          data={QUIET}
          processDefinitionKey="leasing"
          engine="prod-a"
          emptyVariant={emptyVariant}
        />
      </TestViewHost>,
    )
    const note = container.querySelector('[data-empty-variant="empty"]')!
    expect(note.textContent).toContain("No open incidents on Leasing")
    for (const tone of SUCCESS) expect(container.innerHTML).not.toContain(tone)
    if (emptyVariant === "siblings") {
      expect(within(note as HTMLElement).getByRole("button", { name: /^Order/ })).toBeTruthy()
    }
  })
})
