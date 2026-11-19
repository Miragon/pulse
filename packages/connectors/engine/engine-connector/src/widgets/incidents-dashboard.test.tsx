// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { createElement, type ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { IncidentsBar } from "./incidents-dashboard/incidents-bar.js"
import { IncidentProcessList } from "./incidents-dashboard/process-list.js"
import { NavProvider, type NavIntent } from "./navigation.js"
import type { IncidentsDashboardData } from "../view-models.js"
import { ENGINE_INCIDENTS_DATA, ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"
import { TestViewHost, type HostAction } from "@miragon/pulse-widget-shell/widgets"
import { formatInstant, formatRelativeTime } from "@miragon/pulse-ui"

afterEach(() => {
  cleanup()
})

// #335 N61: exact card counts, the scanned breakdown marked partial, null as "—", never 0.
const DATA: IncidentsDashboardData = {
  totalCount: 257,
  processCount: 2,
  affectedActivityCount: null,
  last24hCount: 251,
  latestIncident: "2026-10-10T12:00:00.000+0000",
  filters: {},
  fetchedAt: "2026-10-10T12:05:00.000Z",
  engineVendor: "CIB seven",
  engineId: "prod-a",
  processes: [
    {
      processDefinitionKey: "burst",
      processDefinitionName: "Burst",
      latestVersion: 2,
      runningInstances: 30,
      incidentCount: 250,
      scannedIncidentCount: 200,
      affectedActivityCount: null,
      last24hCount: null,
      latestIncident: "2026-10-10T12:00:00.000+0000",
      cockpitUrl: null,
      activities: [
        {
          activityId: "charge",
          incidentType: "failedJob",
          activityName: null,
          representativeMessage: "card declined",
          scannedIncidentCount: 200,
          last24hCount: null,
          firstSeen: null,
          latestIncident: "2026-10-10T12:00:00.000+0000",
        },
      ],
    },
    {
      processDefinitionKey: "quiet",
      processDefinitionName: "Quiet",
      latestVersion: 1,
      runningInstances: 5,
      incidentCount: 7,
      scannedIncidentCount: 0,
      affectedActivityCount: null,
      last24hCount: 0,
      latestIncident: null,
      cockpitUrl: null,
      activities: [],
    },
  ],
}

const asWidget = (c: unknown) => c as ComponentType<Record<string, unknown>>
const data = DATA as unknown as Record<string, unknown>

describe("the incidents route while its feed fails", () => {
  it("keeps its title, the page's one heading, above the failure", async () => {
    render(
      <TestViewHost
        tools={{
          [ENGINE_INCIDENTS_DATA]: () => {
            throw new Error("engine prod-a unreachable (ECONNREFUSED)")
          },
        }}
      >
        <IncidentsBar data={null} engine="prod-a" />
      </TestViewHost>,
    )
    await screen.findByRole("alert")
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("prod-a · Incidents")
  })
})

// One home per number (V3, X4): the bar says the open incidents in words, the segments count All
// and New in 24h, the cards their processes; no tiles repeat them, and no pill says "Live" where
// nothing reloads by itself (A9): the bar says when the numbers were read.
describe("the incidents route's bar", () => {
  function renderBar(over: Partial<IncidentsDashboardData> = {}) {
    return render(
      <TestViewHost>
        <IncidentsBar data={{ ...DATA, ...over }} engine="prod-a" />
      </TestViewHost>,
    )
  }

  it("says the open incidents in one sentence, the activities only where every breakdown holds", () => {
    const { container } = renderBar()
    const bar = container.querySelector<HTMLElement>("[data-slot='view-bar']")!
    // The unknown activity total is left out, never a 0.
    expect(within(bar).getByText("257 open in 2 processes")).toBeTruthy()
    expect(bar.textContent).not.toMatch(/activit/)
    cleanup()
    renderBar({ affectedActivityCount: 3 })
    expect(screen.getByText("257 open in 2 processes, 3 activities")).toBeTruthy()
  })

  it("carries the alarm on the incident's icon, the count in the foreground (invariant 6)", () => {
    const { container } = renderBar()
    const state = container.querySelector("[data-slot='view-bar'] [data-slot='state-label']")!
    expect(state.getAttribute("data-state")).toBe("incident")
    cleanup()
    const quiet = renderBar({ totalCount: 0, processCount: 0, processes: [] })
    expect(quiet.container.querySelector("[data-slot='state-label']")).toBeNull()
    expect(screen.getByText("0 open in 0 processes")).toBeTruthy()
  })

  it("shows no tiles and no Live pill, and says when the numbers were read at its end", () => {
    const { container } = renderBar()
    expect(container.querySelector("[data-slot='kpi-grid']")).toBeNull()
    expect(container.textContent).not.toMatch(/\bLive\b/)
    const stamp = container.querySelector<HTMLElement>("[data-slot='freshness-stamp']")!
    expect(stamp.textContent).toMatch(/^As of /)
    expect(stamp.title).toContain("2026")
  })

  it("says it in German", () => {
    render(
      <TestViewHost locale="de">
        <IncidentsBar data={{ ...DATA, affectedActivityCount: 1 }} engine="prod-a" />
      </TestViewHost>,
    )
    expect(screen.getByText("257 offen in 2 Prozessen, 1 Aktivität")).toBeTruthy()
  })
})

describe("incidents dashboard widgets: honest numbers", () => {
  it("keeps a process beyond the scan with its exact count and discloses a partial breakdown", () => {
    render(
      <TestViewHost>
        {createElement(asWidget(IncidentProcessList), { data, engine: "prod-a" })}
      </TestViewHost>,
    )

    expect(screen.getByText("250")).toBeTruthy()
    // quiet's incidents all lie beyond the scan; it is still listed, with its exact 7.
    expect(screen.getByText("Quiet")).toBeTruthy()
    expect(screen.getByText("7")).toBeTruthy()

    fireEvent.click(screen.getByText("Burst"))
    expect(
      screen.getByText(
        "Breakdown of the newest 200 of 250 incidents. Open the process for exact counts per activity.",
      ),
    ).toBeTruthy()
  })

  it("the New in 24h scope shows the key's 24h count (— when unknown) and drops a process without any", () => {
    render(
      <TestViewHost>
        {createElement(asWidget(IncidentProcessList), { data, engine: "prod-a" })}
      </TestViewHost>,
    )

    // One pick of two, a radio group as the instance scope, each with its count.
    const scopes = screen.getByRole("radiogroup", { name: "Show incidents" })
    const all = within(scopes).getByRole("radio", { name: /^All/ })
    const last24h = within(scopes).getByRole("radio", { name: /^New in 24h/ })
    expect(all.getAttribute("aria-checked")).toBe("true")
    fireEvent.click(last24h)
    expect(last24h.getAttribute("aria-checked")).toBe("true")
    expect(all.getAttribute("aria-checked")).toBe("false")

    expect(screen.getByText("Burst")).toBeTruthy()
    expect(screen.queryByText("Quiet")).toBeNull()
    expect(screen.queryByText("250")).toBeNull()
  })
})

// A filtered view without an `engine` prop reads its scope from the data echo and never refetches
// (`incidentsFeed` is never ready), so no request can widen it.
describe("incidents dashboard: a filtered view keeps its scope", () => {
  const FILTERED: IncidentsDashboardData = {
    ...DATA,
    totalCount: 7,
    processCount: 1,
    last24hCount: 0,
    latestIncident: null,
    processes: [DATA.processes[1]],
    filters: { processDefinitionKey: "quiet", incidentType: "failedJob" },
  }

  let tools: Record<string, unknown>
  beforeAll(async () => {
    tools = { [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("read-only") }
  })

  let feedCalls: Array<Record<string, unknown>>
  beforeEach(() => {
    feedCalls = []
  })

  async function promptOf(widget: unknown, props: { data?: IncidentsDashboardData }) {
    const actions: HostAction[] = []
    const feed = (args: Record<string, unknown>) => {
      feedCalls.push(args)
      return DATA
    }
    render(
      <TestViewHost
        tools={{ ...tools, [ENGINE_INCIDENTS_DATA]: feed }}
        onHostAction={(action) => actions.push(action)}
      >
        {createElement(asWidget(widget), { data: props.data ?? {}, engine: "prod-a" })}
      </TestViewHost>,
    )
    // A card's chat hand-off sits behind its "more" button (#322 U20).
    await waitFor(() =>
      expect(
        screen.queryAllByRole("button", { name: /in chat|^More actions for / }).length,
      ).toBeGreaterThan(0),
    )
    const more = screen.queryAllByRole("button", { name: /^More actions for / })
    if (more.length > 0) {
      fireEvent.click(more[0])
      fireEvent.click(await screen.findByRole("menuitem", { name: /in chat/ }))
    } else {
      // The toggle wraps the hand-off: click the button itself.
      const [analyze] = (await screen.findAllByRole("button", { name: /in chat/ })).sort(
        (a, b) => (a.textContent ?? "").length - (b.textContent ?? "").length,
      )
      fireEvent.click(analyze)
    }
    const prompts = actions.flatMap((a) => (a.type === "sendFollowUp" ? [a.prompt] : []))
    expect(prompts).toHaveLength(1)
    return prompts[0]
  }

  it("the triage passes the filters as ids and states the filtered count", async () => {
    const prompt = await promptOf(IncidentsBar, { data: FILTERED })

    expect(prompt).toContain(
      'Ids: engine="prod-a", processDefinitionKey="quiet", incidentType="failedJob"\n',
    )
    expect(prompt).toContain("On screen: matchingIncidents=7, processes=1")
    expect(prompt).not.toContain("openIncidents")
    expect(prompt).not.toMatch(/all open incidents on this engine/)
    // Without an engine prop, the scope lives in the data alone: never in a request.
    expect(feedCalls).toEqual([])
  })

  it("an unfiltered triage states the engine's open incidents and no filter", async () => {
    const prompt = await promptOf(IncidentsBar, { data: DATA })

    expect(prompt).toContain('Ids: engine="prod-a"\n')
    expect(prompt).toContain("On screen: openIncidents=257, processes=2")
    expect(prompt).not.toMatch(/matchingIncidents|incidentType=/)
  })

  it("a card's root-cause hand-off carries the incident-type filter of its count", async () => {
    const prompt = await promptOf(IncidentProcessList, { data: FILTERED })

    expect(prompt).toContain(
      'Ids: engine="prod-a", processDefinitionKey="quiet", incidentType="failedJob"\n',
    )
    expect(prompt).toContain('countScope="allVersions", latestVersion=1, matchingIncidents=7')
    expect(prompt).not.toContain("openIncidents")
    expect(feedCalls).toEqual([])
  })

  it("the cockpit self-fetches the engine's whole dashboard and hands off its answer", async () => {
    // The cockpit's incidents view passes the engine alone: no data, no filter.
    const View = (props: Record<string, unknown>) => (
      <IncidentsBar {...props} data={null} engine="prod-a" />
    )
    const prompt = await promptOf(View, {})

    await waitFor(() => expect(feedCalls).toEqual([{ engine: "prod-a" }]))
    expect(prompt).toContain('Ids: engine="prod-a"\n')
    expect(prompt).toContain("On screen: openIncidents=257, processes=2")
  })
})

// N3 step 1, N12, X9: an expanded process lists its activities by their diagram's names, each a
// row that opens its failure cluster; a row never repeats its name as its failure, and the card's
// Open names where it goes.
describe("a process card's activities", () => {
  const ACTIVITIES: IncidentsDashboardData = {
    ...DATA,
    processes: [
      {
        ...DATA.processes[0],
        scannedIncidentCount: 250,
        activities: [
          {
            activityId: "Activity_Charge",
            incidentType: "failedJob",
            activityName: "Charge card",
            representativeMessage: "card declined",
            scannedIncidentCount: 200,
            last24hCount: null,
            firstSeen: "2026-10-09T08:00:00.000+0000",
            latestIncident: "2026-10-10T12:00:00.000+0000",
          },
          {
            // A call activity's incident: no message of its own and its root cause not scanned.
            activityId: "Activity_CallBilling",
            incidentType: "failedJob",
            activityName: null,
            representativeMessage: null,
            scannedIncidentCount: 50,
            last24hCount: null,
            firstSeen: null,
            latestIncident: "2026-10-10T11:00:00.000+0000",
            delegated: true,
            rootCause: null,
          },
          {
            // A call activity's copies, their root cause in the called instance within the scan.
            activityId: "Activity_AssessCredit",
            incidentType: "failedJob",
            activityName: "Assess creditworthiness",
            representativeMessage: "Blacklist provider unreachable",
            scannedIncidentCount: 49,
            last24hCount: null,
            firstSeen: null,
            latestIncident: "2026-10-10T10:00:00.000+0000",
            delegated: true,
            rootCause: {
              activityId: "CheckBlacklist",
              incidentType: "failedJob",
              messageSignature: "blacklist provider unreachable",
              activityName: "Check blacklist",
            },
          },
        ],
      },
    ],
  }

  function renderCard() {
    const go = vi.fn<(intent: NavIntent) => void>()
    render(
      <TestViewHost>
        <NavProvider value={go}>
          <IncidentProcessList data={ACTIVITIES} engine="prod-a" />
        </NavProvider>
      </TestViewHost>,
    )
    fireEvent.click(screen.getByRole("button", { name: /^Burst/, expanded: false }))
    return go
  }

  it("names each activity by its diagram's name, else its id, never the id again as its failure", () => {
    renderCard()
    const table = screen.getByRole("region", { name: "Incidents of Burst by activity" })
    const named = within(table).getByRole("row", { name: "Incidents at Charge card" })
    expect(named.textContent).toContain("card declined")
    const bare = within(table).getByRole("row", {
      name: "Incidents at Activity_CallBilling in Burst",
    })
    expect(bare.textContent?.match(/Activity_CallBilling/g)).toHaveLength(1)
    expect(within(bare).getAllByText("—").length).toBeGreaterThan(0)
  })

  it("opens an activity's failure cluster on a click or Enter, by its activity and type", () => {
    const go = renderCard()
    const row = screen.getByRole("row", { name: "Incidents at Charge card" })
    fireEvent.click(within(row).getByText("card declined"))
    fireEvent.keyDown(row, { key: "Enter" })
    expect(go.mock.calls.map(([intent]) => intent)).toEqual([
      {
        type: "cluster-detail",
        activityId: "Activity_Charge",
        incidentType: "failedJob",
        label: "Charge card",
      },
      {
        type: "cluster-detail",
        activityId: "Activity_Charge",
        incidentType: "failedJob",
        label: "Charge card",
      },
    ])
  })

  // A cluster lists root incidents alone: a delegated row's own would answer 0 next to its count.
  it("opens a delegated row's root cause, by its activity, type and message, named by it", () => {
    const go = renderCard()
    const row = screen.getByRole("row", {
      name: "Incidents at Assess creditworthiness, caused at Check blacklist",
    })
    expect(row.textContent).toContain("Blacklist provider unreachable")
    fireEvent.keyDown(row, { key: "Enter" })
    expect(go).toHaveBeenCalledWith({
      type: "cluster-detail",
      activityId: "CheckBlacklist",
      incidentType: "failedJob",
      messageSignature: "blacklist provider unreachable",
      label: "Check blacklist",
    })
    expect(go).not.toHaveBeenCalledWith(
      expect.objectContaining({ activityId: "Activity_AssessCredit" }),
    )
  })

  it("opens the process for a delegated row whose root cause lies beyond the scan", () => {
    const go = renderCard()
    fireEvent.click(screen.getByRole("row", { name: "Incidents at Activity_CallBilling in Burst" }))
    expect(go.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "process-incidents", processDefinitionKey: "burst", label: "Burst" },
    ])
  })

  // One grammar per fact: "first seen" and "last" read as a time ago, the instant in the title, as
  // the process view's groups and its bar and the cluster's bar read them.
  it("says when an activity was first seen and the card's last incident as a time ago", () => {
    renderCard()
    const row = screen.getByRole("row", { name: "Incidents at Charge card" })
    const firstSeen = row.querySelector("time")!
    expect(firstSeen.textContent).toBe(formatRelativeTime("2026-10-09T08:00:00.000+0000"))
    expect(firstSeen.getAttribute("title")).toBe(formatInstant("2026-10-09T08:00:00.000+0000"))
    // Unknown is "—", with no instant to title it.
    const bare = screen.getByRole("row", { name: "Incidents at Activity_CallBilling in Burst" })
    expect(bare.querySelector("time")).toBeNull()

    const last = screen.getByText(/^last /)
    expect(last.tagName).toBe("TIME")
    expect(last.textContent).toBe(`last ${formatRelativeTime(DATA.processes[0].latestIncident)}`)
    expect(last.getAttribute("title")).toBe(formatInstant(DATA.processes[0].latestIncident))
  })

  it("names the card's Open by its visible word and its real target, the process", () => {
    const go = renderCard()
    fireEvent.click(screen.getByRole("button", { name: "Open Burst" }))
    expect(go).toHaveBeenCalledWith({
      type: "process-incidents",
      processDefinitionKey: "burst",
      label: "Burst",
    })
  })
})
