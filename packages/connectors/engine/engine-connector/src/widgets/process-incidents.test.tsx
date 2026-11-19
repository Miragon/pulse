// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import { TONE_DOT, TONE_ICON, formatInstant } from "@miragon/pulse-ui"
import { ProcessDetailHeader } from "./process-incidents/header.js"
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

describe("definition view: affected activities over the diagram", () => {
  it("counts only the diagram's activities, with no denominator, and names the older-version ones under it", () => {
    render(
      <TestViewHost>
        <Kpi data={DATA as never} />
      </TestViewHost>,
    )

    const cell = screen
      .getByText("Affected activities")
      .closest<HTMLElement>('[data-slot="kpi-strip"] > div > *')!
    expect(within(cell).getByText("1")).toBeTruthy()
    expect(within(cell).queryByText("/2")).toBeNull()
    expect(within(cell).getByText("+1 only in older versions")).toBeTruthy()
    expect(within(cell).queryByText("2")).toBeNull()
  })

  it("names the new incidents of a day without a plus, and leaves the version scope to the bar", () => {
    const { container } = render(
      <TestViewHost>
        <Kpi data={{ ...DATA, last24hCount: 4 }} />
      </TestViewHost>,
    )
    const cell = screen
      .getByText("New in 24h")
      .closest<HTMLElement>('[data-slot="kpi-strip"] > div > *')!
    expect(cell.textContent).toBe("New in 24h4")
    expect(container.textContent).not.toMatch(/\+24h|\+4|all versions|Process health/)
    // The strip is still named, as a group, for a screen reader.
    expect(screen.getByRole("group", { name: "Process health" })).toBeTruthy()
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

// One home per number (D6, X4): the bar says what no tile says, and the dates read as a time ago.
describe("definition view: the bar and the dates", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("names the key and the version scope once, the last event as a time ago, and when it was read", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-10T15:00:00.000Z"))
    render(
      <TestViewHost>
        <ProcessDetailHeader
          data={{ ...DATA, fetchedAt: "2026-10-10T14:55:00.000Z" }}
          processDefinitionKey="leasing"
          engine="prod-a"
        />
      </TestViewHost>,
    )
    const bar = document.querySelector<HTMLElement>('[data-slot="view-bar"]')!
    const facts = bar.querySelector<HTMLElement>('[data-slot="view-bar-facts"]')!
    expect(facts.textContent).toBe("leasing·all versions·last event 3h ago")
    const last = within(facts).getByText("last event 3h ago")
    expect(last.getAttribute("title")).toBe(formatInstant(DATA.latestIncident))
    // No count of a tile: neither the open incidents nor the running instances.
    expect(bar.textContent).not.toMatch(/\b(3|99) (open incidents|running instances)/)
    // When the numbers were read: the stamp at the bar's end, never a fact.
    const stamp = bar.querySelector<HTMLElement>('[data-slot="freshness-stamp"]')!
    expect(stamp.textContent).toMatch(/^As of /)
    expect(facts.contains(stamp)).toBe(false)
  })

  it("an older payload without its read time shows no stamp, never a guess", () => {
    render(
      <TestViewHost>
        <ProcessDetailHeader data={DATA} processDefinitionKey="leasing" engine="prod-a" />
      </TestViewHost>,
    )
    expect(document.querySelector('[data-slot="freshness-stamp"]')).toBeNull()
  })

  it("an activity's group says first seen and latest as a time ago at 400, its instant in the title", () => {
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-10T15:00:00.000Z"))
    const { container } = render(
      <TestViewHost>
        <ActivityIncidentList
          data={{
            ...DATA,
            activities: [{ ...DATA.activities[0], firstSeen: "2026-10-08T15:00:00.000Z" }],
          }}
          processDefinitionKey="leasing"
          engine="prod-a"
        />
      </TestViewHost>,
    )
    // No count beside the heading: the affected activities are the KPI tile's.
    expect(
      screen.getByRole("heading", { name: "Incidents by activity" }).parentElement!.textContent,
    ).toBe("Incidents by activity")
    const stats = container.querySelector<HTMLElement>('[data-slot="group-summary-stats"]')!
    const times = [...stats.querySelectorAll("time")]
    expect(times.map((time) => time.textContent)).toEqual(["2d ago", "3h ago"])
    expect(times[0].getAttribute("title")).toBe(formatInstant("2026-10-08T15:00:00.000Z"))
    for (const time of times) expect(time.parentElement!.className).not.toContain("font-semibold")
  })

  it("an activity whose first incident lies beyond the scan says — for it, never a guess", () => {
    const { container } = render(
      <TestViewHost>
        <ActivityIncidentList data={DATA} processDefinitionKey="leasing" engine="prod-a" />
      </TestViewHost>,
    )
    const stats = container.querySelector<HTMLElement>('[data-slot="group-summary-stats"]')!
    expect(stats.textContent).toContain("—first seen")
  })
})
