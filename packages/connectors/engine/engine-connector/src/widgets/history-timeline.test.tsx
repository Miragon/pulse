// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  explainActivityHandOff,
  HistoryTimelineWidget,
  PagedHistoryView,
} from "./history-timeline.js"
import type { HistoryTimelineData } from "../view-models.js"
import { ENGINE_HISTORY_TIMELINE_DATA } from "../tool-names.js"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"
import { formatClock, formatDuration, formatInstant } from "@miragon/pulse-ui"

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

/** The history route on the cockpit's engine, the fixture's `default`, for the fixture's instance. */
const Widget = ({ data }: { data: HistoryTimelineData }) => (
  <HistoryTimelineWidget data={data} processInstanceId="pi-1" engine="default" />
)

/** The text of each cell of the steps table's rows, hidden columns included. */
function rowsOf(table: HTMLElement): string[][] {
  return [...table.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent ?? ""),
  )
}

describe("HistoryTimelineWidget (fixture render)", () => {
  it("titles the route by the instance, names its process in the facts, and lists the steps as one table", () => {
    render(
      <TestViewHost>
        <Widget
          data={{ ...DATA, processInstance: { ...DATA.processInstance!, businessKey: "INV-7" } }}
        />
      </TestViewHost>,
    )

    // The instance by its one label, its whole id in the title; the process and its state beside.
    const heading = screen.getByRole("heading", { name: "INV-7" })
    expect(heading.querySelector("[title='pi-1']")).toBeTruthy()
    const bar = document.querySelector<HTMLElement>('[data-slot="view-bar"]')!
    expect(within(bar).getByText("Invoice Process")).toBeTruthy()
    expect(within(bar).getByText("Completed")).toBeTruthy()

    // The one steps table: no rail, no cards, no engine type in camelCase.
    const table = screen.getByRole("region", { name: "Activity history of this process instance" })
    expect(document.querySelector("ol, li")).toBeNull()
    expect(document.body.textContent).not.toMatch(/startEvent|userTask/)
    expect(rowsOf(table)).toEqual([
      // An instant event has no duration of its own: no "0ms".
      ["Start", "Completed", formatClock(DATA.activities[0].startTime), "", ""],
      [
        "Review Invoiceassigned to demo",
        "Completed",
        formatClock(DATA.activities[1].startTime),
        formatDuration(120_000),
        "",
      ],
    ])
    // The slowest step's row ends in its hand-off, the others in nothing.
    const [start, review] = table.querySelectorAll("tbody tr")
    expect(within(start as HTMLElement).queryByRole("button")).toBeNull()
    expect(
      within(review as HTMLElement).getByRole("button", { name: "Explain duration in chat" }),
    ).toBeTruthy()
  })

  it("leaves the actions column out where the host hides hand-offs", () => {
    render(
      <TestViewHost followUp="none">
        <Widget data={DATA} />
      </TestViewHost>,
    )
    const table = screen.getByRole("region", { name: "Activity history of this process instance" })
    expect(rowsOf(table).map((cells) => cells.length)).toEqual([4, 4])
    expect(within(table).queryByRole("button")).toBeNull()
  })

  // X1, D9: every route says when it was read, once, at its bar's end.
  it("says when the server read the history, once at the bar's end, never among its facts", () => {
    const fetchedAt = "2026-01-01T10:41:00.000Z"
    const { container } = render(
      <TestViewHost>
        <Widget data={{ ...DATA, fetchedAt }} />
      </TestViewHost>,
    )
    const bar = container.querySelector<HTMLElement>('[data-slot="view-bar"]')!
    const stamps = bar.querySelectorAll<HTMLElement>('[data-slot="freshness-stamp"]')
    expect(stamps).toHaveLength(1)
    expect(stamps[0].textContent).toBe(`As of ${formatClock(fetchedAt, { seconds: false })}`)
    expect(stamps[0].title).toBe(formatInstant(fetchedAt))
    expect(
      bar.querySelector('[data-slot="view-bar-facts"] [data-slot="freshness-stamp"]'),
    ).toBeNull()
  })

  it("keeps the stamp on the route's bar for an instance the history does not know", () => {
    const fetchedAt = "2026-01-01T10:41:00.000Z"
    const { container } = render(
      <TestViewHost>
        <HistoryTimelineWidget
          data={{ ...DATA, processInstance: null, fetchedAt }}
          processInstanceId="pi-1"
          engine="default"
          title="History"
        />
      </TestViewHost>,
    )
    const bar = container.querySelector<HTMLElement>('[data-slot="view-bar"]')!
    expect(within(bar).getByRole("heading", { level: 1 }).textContent).toBe("History")
    expect(bar.querySelectorAll('[data-slot="freshness-stamp"]')).toHaveLength(1)
  })

  it("titles an instance without a business key by its short id", () => {
    render(
      <TestViewHost>
        <Widget
          data={{
            ...DATA,
            processInstance: {
              ...DATA.processInstance!,
              id: "3c1e4f2a-9b7d-11ef-8c2a-0242ac120002",
              businessKey: null,
            },
          }}
        />
      </TestViewHost>,
    )
    expect(screen.getByRole("heading", { name: /^3c1e4f2a/ }).textContent).not.toContain(
      "0242ac120002",
    )
  })

  it("says since when an open step runs and how long so far", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-01-03T10:00:00.000Z"))
    try {
      const waiting = {
        ...DATA.activities[1],
        endTime: null,
        durationInMillis: null,
        assignee: null,
      }
      render(
        <TestViewHost>
          <Widget data={{ ...DATA, activities: [DATA.activities[0], waiting] }} />
        </TestViewHost>,
      )
      const table = screen.getByRole("region", {
        name: "Activity history of this process instance",
      })
      const [, open] = rowsOf(table)
      expect(open[2]).toBe(`since ${formatClock(waiting.startTime)}`)
      expect(open[3]).toBe(formatDuration(2 * 86_400_000))
    } finally {
      vi.useRealTimers()
    }
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
      <TestViewHost>
        <Widget
          data={{
            ...DATA,
            activities: [DATA.activities[0], running, end],
            totalActivities: 3,
            incidentActivityIds: ["charge"],
          }}
        />
      </TestViewHost>,
    )
    const stuck = screen.getByText("Charge card").closest("tr")!
    const state = within(stuck).getByText("Incident").closest('[data-slot="state-label"]')!
    expect(state.getAttribute("data-tone")).toBe("danger")
    // The end event reads completed, neutral like every completed step.
    const done = screen.getByText("Paid").closest("tr")!
    expect(
      within(done)
        .getByText("Completed")
        .closest('[data-slot="state-label"]')!
        .getAttribute("data-tone"),
    ).not.toBe("danger")
    // No categorical palette class anywhere in the table.
    expect(container.innerHTML).not.toMatch(
      /bg-(purple|indigo|pink|cyan|teal|orange|amber|yellow|blue)-/,
    )
  })
})

/** The history route: no seed, so the widget reads its own feed on the cockpit's engine. */
describe("HistoryTimelineWidget self-fetch", () => {
  it("reads the timeline feed for its instance on its engine", async () => {
    const feed = vi.fn(() => DATA)
    render(
      <TestViewHost tools={{ [ENGINE_HISTORY_TIMELINE_DATA]: feed }}>
        <HistoryTimelineWidget processInstanceId="pi-1" engine="prod-a" />
      </TestViewHost>,
    )
    expect(await screen.findByText("Invoice Process")).toBeTruthy()
    expect(feed).toHaveBeenCalledWith({ processInstanceId: "pi-1", engine: "prod-a" })
  })

  it("says it is loading while the feed has not answered", () => {
    render(
      <TestViewHost tools={{ [ENGINE_HISTORY_TIMELINE_DATA]: () => new Promise(() => {}) }}>
        <HistoryTimelineWidget processInstanceId="pi-1" engine="prod-a" />
      </TestViewHost>,
    )
    expect(screen.getByText("Loading activity history…")).toBeTruthy()
  })

  it("shows a failed read with a retry that reads again", async () => {
    const feed = vi.fn(() => {
      throw new Error("engine unreachable")
    })
    render(
      <TestViewHost
        tools={{ [ENGINE_HISTORY_TIMELINE_DATA]: feed }}
        client={createTestQueryClient()}
      >
        <HistoryTimelineWidget processInstanceId="pi-1" engine="prod-a" />
      </TestViewHost>,
    )
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }))
    await waitFor(() => expect(feed).toHaveBeenCalledTimes(2))
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
      <TestViewHost tools={{ engine_query_historic_activity_instances: history }}>
        <Widget data={{ ...DATA, totalActivities: 3 }} />
      </TestViewHost>,
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
    render(
      <TestViewHost>
        <Widget data={DATA as never} />
      </TestViewHost>,
    )
    expect(screen.queryByText("Load more")).toBeNull()
  })
})

// The history tab of the instance and incident views pages on its own (invariant 6: worded, its
// engine text only under "Details", and a retry).
describe("PagedHistoryView's failed first page", () => {
  it("words the failure, keeps the engine's text under Details and reads again on retry", async () => {
    const history = vi.fn(() => ({
      isError: true,
      content: [
        {
          type: "text",
          text: "[500 ProcessEngineException] Boom raw-engine-text at org.camunda.Secret.java:42 (engine prod-a)",
        },
      ],
    }))
    render(
      <TestViewHost
        tools={{ engine_query_historic_activity_instances: history }}
        client={createTestQueryClient()}
      >
        <PagedHistoryView processInstanceId="pi-1" engine="prod-a" />
      </TestViewHost>,
    )
    const title = await screen.findByText("Engine prod-a reported an error (HTTP 500)")
    const state = title.closest('[data-slot="error-state"]')!
    expect(state.querySelector("details")?.textContent).toContain("raw-engine-text")
    const shown = document.body.cloneNode(true) as HTMLElement
    for (const details of shown.querySelectorAll("details")) details.remove()
    expect(shown.textContent).not.toContain("raw-engine-text")
    fireEvent.click(within(state as HTMLElement).getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(history).toHaveBeenCalledTimes(2))
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
    expect(handOff.ids).toMatchObject({
      engine: "prod",
      processInstanceId: "pi-1",
      processDefinitionKey: "invoice",
    })
  })

  it("leaves the key out where the definition id names none", () => {
    const handOff = explainActivityHandOff(
      activity,
      { id: "pi-1", processDefinitionKey: null },
      "prod",
    )
    expect(handOff.ids?.processDefinitionKey).toBeUndefined()
  })
})
