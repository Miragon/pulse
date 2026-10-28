// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost, type HostActionLog } from "@miragon/mcp-toolkit-ui/app"
import { IncidentOverviewKpi } from "./incidents-dashboard/overview-kpi.js"
import { IncidentProcessList } from "./incidents-dashboard/process-list.js"
import type { IncidentsDashboardData } from "../view-models.js"
import { CAMUNDA7_INCIDENTS_DATA, CAMUNDA7_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"

afterEach(() => {
  cleanup()
  queryClient.clear()
})

// #335 N61: exact card counts, the scanned breakdown marked partial, null as "—", never 0.
const DATA: IncidentsDashboardData = {
  totalCount: 257,
  processCount: 2,
  affectedActivityCount: null,
  last24hCount: 251,
  latestIncident: "2026-10-10T12:00:00.000+0000",
  filters: {},
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

describe("incidents dashboard widgets — honest numbers", () => {
  it("shows the unknown affected-activity total as —, never 0", () => {
    render(<WidgetFixtureHost widget={asWidget(IncidentOverviewKpi)} data={data} />)

    const cell = screen
      .getByText("Activities affected")
      .closest<HTMLElement>('[data-slot="kpi-strip"] > div > *')!
    expect(within(cell).getByText("—")).toBeTruthy()
    expect(within(cell).queryByText("0")).toBeNull()
  })

  it("keeps a process beyond the scan with its exact count and discloses a partial breakdown", () => {
    render(<WidgetFixtureHost widget={asWidget(IncidentProcessList)} data={data} />)

    expect(screen.getByText("250")).toBeTruthy()
    // quiet's incidents all lie beyond the scan — still listed, with its exact 7.
    expect(screen.getByText("Quiet")).toBeTruthy()
    expect(screen.getByText("7")).toBeTruthy()

    fireEvent.click(screen.getByText("Burst"))
    expect(
      screen.getByText(
        "Breakdown of the newest 200 of 250 incidents. Open the process for exact counts per activity.",
      ),
    ).toBeTruthy()
  })

  it("the Last 24h chip shows the key's 24h count (— when unknown) and drops a process without any", () => {
    render(<WidgetFixtureHost widget={asWidget(IncidentProcessList)} data={data} />)

    fireEvent.click(screen.getByText("Last 24h"))

    expect(screen.getByText("Burst")).toBeTruthy()
    expect(screen.queryByText("Quiet")).toBeNull()
    expect(screen.queryByText("250")).toBeNull()
  })
})

// A filtered standalone view reads its scope from the data echo and never refetches (no `engine`
// prop, so `incidentsFeed` is never ready), so no request can widen it.
describe("incidents dashboard — a filtered view keeps its scope", () => {
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
    tools = { [CAMUNDA7_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("read-only") }
  })

  let feedCalls: Array<Record<string, unknown>>
  beforeEach(() => {
    feedCalls = []
  })

  async function promptOf(widget: unknown, props: { data?: IncidentsDashboardData }) {
    const actions: HostActionLog[] = []
    const feed = (args: Record<string, unknown>) => {
      feedCalls.push(args)
      return DATA
    }
    render(
      <WidgetFixtureHost
        widget={asWidget(widget)}
        data={(props.data ?? {}) as unknown as Record<string, unknown>}
        tools={{ ...tools, [CAMUNDA7_INCIDENTS_DATA]: feed }}
        onHostAction={(action) => actions.push(action)}
      />,
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
    const prompts = actions.flatMap((a) => (a.type === "sendFollowUpMessage" ? [a.prompt] : []))
    expect(prompts).toHaveLength(1)
    return prompts[0]
  }

  it("the triage passes the filters as ids and states the filtered count", async () => {
    const prompt = await promptOf(IncidentOverviewKpi, { data: FILTERED })

    expect(prompt).toContain(
      'Ids: engine="prod-a", processDefinitionKey="quiet", incidentType="failedJob"\n',
    )
    expect(prompt).toContain("On screen: matchingIncidents=7, processes=1")
    expect(prompt).not.toContain("openIncidents")
    expect(prompt).not.toMatch(/all open incidents on this engine/)
    // Standalone, the scope lives in the data alone — never in a request.
    expect(feedCalls).toEqual([])
  })

  it("an unfiltered triage states the engine's open incidents and no filter", async () => {
    const prompt = await promptOf(IncidentOverviewKpi, { data: DATA })

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
    // The cockpit's incidents view passes the engine alone — no data, no filter.
    const View = (props: Record<string, unknown>) => (
      <IncidentOverviewKpi {...props} data={null} engine="prod-a" />
    )
    const prompt = await promptOf(View, {})

    await waitFor(() => expect(feedCalls).toEqual([{ engine: "prod-a" }]))
    expect(prompt).toContain('Ids: engine="prod-a"\n')
    expect(prompt).toContain("On screen: openIncidents=257, processes=2")
  })
})
