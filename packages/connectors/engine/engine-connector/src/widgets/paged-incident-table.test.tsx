// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import type {
  ActivityIncidentsData,
  IncidentInstance,
  ProcessIncidentsData,
} from "../view-models.js"
import { ENGINE_ACTIVITY_INCIDENTS_DATA } from "../tool-names.js"
import { ActivityIncidentList } from "./process-incidents/list.js"

afterEach(cleanup)

const DATA: ProcessIncidentsData = {
  processDefinitionKey: "leasing",
  processDefinitionName: "Leasing",
  diagramVersion: 2,
  diagramDefinitionId: null,
  cockpitUrl: null,
  runningInstances: 9,
  incidentCount: 3,
  failedJobs: 0,
  totalActivityCount: 1,
  affectedDiagramActivityCount: 1,
  latestIncident: "2026-10-10T12:00:00.000+0000",
  activities: [
    {
      activityId: "assess",
      activityName: "Assess creditworthiness",
      representativeMessage: "assess failed",
      incidentCount: 3,
      firstSeen: null,
      latestIncident: "2026-10-10T12:00:00.000+0000",
    },
  ],
  siblingsWithIncidents: null,
  fetchedAt: "2026-10-10T12:00:00.000Z",
  engineVendor: "CIB seven",
  engineId: "prod-a",
}

const incident = (n: number): IncidentInstance => ({
  id: `inc-assess-${n}`,
  processInstanceId: `pi-assess-${n}`,
  businessKey: `LEA-${n}`,
  incidentType: "failedJob",
  incidentMessage: "assess failed",
  incidentTimestamp: "2026-10-10T12:00:00.000+0000",
  activityId: "assess",
  activityName: "Assess creditworthiness",
  recovery: { action: "none" },
  cockpitInstanceUrl: null,
  rootIncidentId: null,
})

/** A page of the feed: the first counts (`totalCount`), a later one answers none. */
const page = (
  incidents: IncidentInstance[],
  next: string | null,
  totalCount: number | null = null,
): ActivityIncidentsData => ({
  processDefinitionKey: "leasing",
  activityId: "assess",
  incidents,
  totalCount,
  next,
  engineId: "prod-a",
})

/** The group's list over a feed that answers each cursor from `pages` ("" for the first page). */
function renderGroup(pages: Readonly<Record<string, ActivityIncidentsData>>) {
  const asked: Record<string, unknown>[] = []
  const feed = (args: Record<string, unknown>) => {
    asked.push(args)
    return pages[typeof args.after === "string" ? args.after : ""]
  }
  render(
    <TestViewHost tools={{ [ENGINE_ACTIVITY_INCIDENTS_DATA]: feed }}>
      <ActivityIncidentList data={DATA} processDefinitionKey="leasing" engine="prod-a" />
    </TestViewHost>,
  )
  fireEvent.click(screen.getByText("Assess creditworthiness"))
  return asked
}

describe("an activity group pages its incidents by the feed's cursor", () => {
  it("reads the next page by the cursor of the one before, until a page names none", async () => {
    const asked = renderGroup({
      "": page([incident(0), incident(1)], "2,-", 3),
      "2,-": page([incident(2)], null),
    })
    expect(await screen.findByRole("row", { name: "Incident of instance LEA-1" })).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Load more" }))

    expect(await screen.findByRole("row", { name: "Incident of instance LEA-2" })).toBeTruthy()
    expect(asked).toEqual([
      { processDefinitionKey: "leasing", activityId: "assess", engine: "prod-a", maxResults: 10 },
      {
        processDefinitionKey: "leasing",
        activityId: "assess",
        engine: "prod-a",
        after: "2,-",
        maxResults: 10,
      },
    ])
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull()
  })

  it("says no incident is open only where no page follows an empty one", async () => {
    renderGroup({ "": page([], "1998,-", 1), "1998,-": page([incident(0)], null) })
    const more = await screen.findByRole("button", { name: "Load more" })

    expect(screen.queryByText("No open incidents.")).toBeNull()
    fireEvent.click(more)
    expect(await screen.findByRole("row", { name: "Incident of instance LEA-0" })).toBeTruthy()
  })

  it("offers Load more while a page follows, over a first page that counted none", async () => {
    const ten = Array.from({ length: 10 }, (_, n) => incident(n))
    renderGroup({ "": page(ten, "10,-", 0), "10,-": page([incident(10)], null) })

    const more = await screen.findByRole("button", { name: "Load more" })
    expect(screen.getByText("Showing 10 of 11 incidents")).toBeTruthy()
    fireEvent.click(more)
    expect(await screen.findByRole("row", { name: "Incident of instance LEA-10" })).toBeTruthy()
  })
})
