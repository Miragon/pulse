// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { explainActivityHandOff, HistoryTimelineWidget } from "./history-timeline.js"
import type { HistoryTimelineData } from "../view-models.js"

afterEach(cleanup)

const DATA: HistoryTimelineData = {
  processInstance: {
    id: "pi-1",
    processDefinitionKey: "invoice",
    processDefinitionName: "Invoice Process",
    startTime: "2026-01-01T10:00:00.000Z",
    endTime: "2026-01-01T10:05:00.000Z",
    durationInMillis: 300_000,
    state: "COMPLETED",
  },
  activities: [
    {
      id: "a1",
      activityId: "start",
      activityName: "Start",
      activityType: "startEvent",
      startTime: "2026-01-01T10:00:00.000Z",
      endTime: "2026-01-01T10:00:00.000Z",
      durationInMillis: 0,
      assignee: null,
      taskId: null,
    },
    {
      id: "a2",
      activityId: "review",
      activityName: "Review Invoice",
      activityType: "userTask",
      startTime: "2026-01-01T10:00:00.000Z",
      endTime: "2026-01-01T10:02:00.000Z",
      durationInMillis: 120_000,
      assignee: "demo",
      taskId: "t1",
    },
  ],
  totalActivities: 2,
  incidentActivityIds: null,
  engineId: "default",
}

// The fixture-host prop type is intentionally loose.
const Widget = HistoryTimelineWidget as unknown as ComponentType<Record<string, unknown>>

describe("HistoryTimelineWidget (fixture render)", () => {
  it("renders the process header and per-activity rows from fixture data", () => {
    render(<WidgetFixtureHost widget={Widget} data={DATA as unknown as Record<string, unknown>} />)

    // Process header (processInstance.processDefinitionName + its state in words).
    expect(screen.getByText("Invoice Process")).toBeTruthy()
    expect(screen.getByText("Completed")).toBeTruthy()

    // The accessible timeline list and its activity rows.
    expect(screen.getByRole("list", { name: "Activity history timeline" })).toBeTruthy()
    expect(screen.getByText("Review Invoice")).toBeTruthy()
    expect(screen.getByText("userTask")).toBeTruthy()

    // Duration formatting via the shared widget-shell helper: 120_000ms → "2m 0s".
    expect(screen.getByText("2m 0s")).toBeTruthy()
  })

  // #322 U14: a dot per BPMN type said nothing, and red on every end event
  // read as an error. The type stays text; colour marks state only.
  it("marks the step stuck at an open incident, and no type in a colour of its own", () => {
    const running = {
      ...DATA.activities[1],
      id: "a2",
      activityId: "charge",
      activityName: "Charge card",
      activityType: "serviceTask",
      endTime: null,
      durationInMillis: null,
      assignee: null,
    }
    const end = {
      ...DATA.activities[0],
      id: "a9",
      activityId: "end",
      activityName: "Paid",
      activityType: "endEvent",
    }
    const { container } = render(
      <WidgetFixtureHost
        widget={Widget}
        data={{
          ...DATA,
          activities: [DATA.activities[0], running, end],
          totalActivities: 3,
          incidentActivityIds: ["charge"],
        }}
      />,
    )
    const stuck = screen.getByText("Charge card").closest("li")!
    expect(within(stuck).getByText("Incident")).toBeTruthy()
    expect(stuck.querySelector(".bg-danger")).toBeTruthy()
    // The end event's dot is neutral, like every completed step.
    const done = screen.getByText("Paid").closest("li")!
    expect(done.querySelector(".bg-danger")).toBeNull()
    // No categorical palette class anywhere in the timeline.
    expect(container.innerHTML).not.toMatch(
      /bg-(purple|indigo|pink|cyan|teal|orange|amber|yellow|blue)-/,
    )
  })

  it("renders the empty state when data is null", () => {
    render(<HistoryTimelineWidget data={null} />)
    expect(screen.getByText("No data available")).toBeTruthy()
  })
})

/** A longer timeline continues through "Load more" on the same engine instead of ending silently. */
describe("HistoryTimelineWidget paging", () => {
  const nextActivity = {
    ...DATA.activities[1],
    id: "a3",
    activityId: "archive",
    activityName: "Archive Invoice",
    activityType: "serviceTask",
  }

  it("pages the rest of a long timeline from the history query", async () => {
    const history = vi.fn(() => ({ items: [nextActivity], totalCount: 3 }))
    render(
      <WidgetFixtureHost
        widget={Widget}
        data={{ ...DATA, totalActivities: 3 }}
        tools={{ camunda7_query_historic_activity_instances: history }}
      />,
    )
    expect(screen.getByText("Invoice Process")).toBeTruthy()
    expect(screen.getByText(/Showing 2 of 3 activities/)).toBeTruthy()

    fireEvent.click(screen.getByText("Load more"))

    expect(await screen.findByText("Archive Invoice")).toBeTruthy()
    expect(history).toHaveBeenCalledWith({
      processInstanceId: "pi-1",
      sortBy: "startTime",
      sortOrder: "asc",
      engine: "default",
      firstResult: 2,
      maxResults: 100,
    })
    expect(screen.queryByText("Load more")).toBeNull()
  })

  it("offers no Load more when the page is the whole timeline", () => {
    render(<WidgetFixtureHost widget={Widget} data={DATA as unknown as Record<string, unknown>} />)
    expect(screen.queryByText("Load more")).toBeNull()
  })
})

// #344 N120: without header data a row's hand-off still names its instance and key.
describe("explainActivityHandOff", () => {
  const activity = {
    id: "act-1",
    activityId: "chargeCard",
    activityName: "Charge card",
    activityType: "serviceTask",
    startTime: "2026-10-10T08:00:00.000+0000",
    endTime: "2026-10-10T08:01:00.000+0000",
    durationInMillis: 60_000,
  } as Parameters<typeof explainActivityHandOff>[0]

  it("names the instance and the key the rows belong to", () => {
    const handOff = explainActivityHandOff(
      activity,
      { id: "pi-1", processDefinitionKey: "invoice" },
      "prod",
    )
    expect(handOff.ids).toMatchObject({ engine: "prod", processInstanceId: "pi-1" })
    expect(handOff.toolIds?.analytics_element_bottleneck).toEqual({
      processDefinitionKey: "invoice",
    })
  })

  it("leaves the key out where the definition id names none", () => {
    const handOff = explainActivityHandOff(
      activity,
      { id: "pi-1", processDefinitionKey: null },
      "prod",
    )
    expect(handOff.toolIds?.analytics_element_bottleneck).toEqual({
      processDefinitionKey: undefined,
    })
  })
})
