// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { formatClock, formatInstant, formatNumber, formatRelativeTime } from "@miragon/pulse-ui"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import { ClusterDetailWidget, describeCluster } from "./cluster-detail.js"
import { NavProvider, type NavIntent } from "./navigation.js"
import type { ClusterDetailData } from "../view-models.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import { bindHandOff } from "./lib/hand-off.js"
import { widgetActionsFeedFor } from "./lib/hand-off.test-support.js"

afterEach(() => {
  cleanup()
})

/** The fix-or-diagnose offer follows the deployment's gate: this fixture runs as `operations`. */
let tools: Record<string, unknown>
beforeAll(async () => {
  tools = { [ENGINE_WIDGET_ACTIONS_DATA]: await widgetActionsFeedFor("operations") }
})

const CLUSTER: ClusterDetailData = {
  activityId: "callWMS",
  activityName: null,
  incidentType: "failedExternalTask",
  messageSignature: "connection timeout to wms after <n>ms",
  incidentCount: 40,
  scannedIncidentCount: 40,
  lastHourCount: 9,
  firstSeen: "2026-06-11T08:00:00.000Z",
  latestIncident: "2026-06-11T14:00:00.000Z",
  processDefinitionKeys: ["shipping"],
  process: { processDefinitionKey: "shipping" },
  representativeMessage: "Connection timeout to WMS after 30000ms",
  incidents: [
    {
      incidentId: "inc-1",
      processInstanceId: "pi-1",
      businessKey: "ORDER-4711",
      processDefinitionKey: "shipping",
      processDefinitionName: null,
      incidentTimestamp: "2026-06-11T14:00:00.000Z",
    },
    {
      incidentId: "inc-2",
      processInstanceId: "a1b2c3d4-0000-0000-0000-000000000000",
      businessKey: null,
      processDefinitionKey: "shipping",
      processDefinitionName: null,
      incidentTimestamp: "2026-06-11T13:00:00.000Z",
    },
  ],
  totalMatching: 40,
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: "default",
}

/** The cluster route on the fixtures' engine, for the fixture's cluster. */
const Widget = ({ data }: { data: ClusterDetailData }) => (
  <ClusterDetailWidget
    data={data}
    engine="default"
    activityId={CLUSTER.activityId}
    incidentType={CLUSTER.incidentType}
    messageSignature={CLUSTER.messageSignature ?? undefined}
  />
)

describe("ClusterDetailWidget (fixture render)", () => {
  it("renders the cluster header, message, and its incidents named by their instances", async () => {
    render(
      <TestViewHost tools={tools}>
        <Widget data={CLUSTER as never} />
      </TestViewHost>,
    )

    // Cluster identity + the guarded remediation handoff.
    expect(screen.getByText("callWMS")).toBeTruthy()
    // The engine's type in the catalog's words (the extension's), never its code.
    expect(screen.getByText("Failed external task")).toBeTruthy()
    expect(screen.queryByText("failedExternalTask")).toBeNull()
    expect(await screen.findByText("Plan a fix in chat")).toBeTruthy()

    // Full sample failure message.
    expect(screen.getByText("Connection timeout to WMS after 30000ms")).toBeTruthy()

    // The business key, else the short id (#322 U13).
    expect(screen.getByText("ORDER-4711")).toBeTruthy()
    expect(screen.getByText("a1b2c3d4…")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Copy a1b2c3d4…" })).toBeTruthy()
    expect(screen.getByText(/Showing 2 of 40 incidents/)).toBeTruthy()
    expect(screen.getByText("Load more")).toBeTruthy()

    // Each row is one incident and opens it itself (one row convention): no column of buttons.
    expect(screen.getByRole("row", { name: "Incident of instance ORDER-4711" })).toBeTruthy()
    expect(screen.getByRole("row", { name: "Incident of instance a1b2c3d4…" })).toBeTruthy()
    expect(screen.queryByText("Actions", { selector: "th" })).toBeNull()
    expect(screen.queryAllByRole("button", { name: /incident/i })).toEqual([])
    // The scan holds the whole cluster: no capped-list note.
    expect(screen.queryByText(/The list covers the newest/)).toBeNull()
  })

  it("names the table after its incidents, the one landmark of that name", () => {
    render(
      <TestViewHost>
        <Widget data={CLUSTER as never} />
      </TestViewHost>,
    )
    expect(screen.getByRole("heading", { level: 2, name: "Incidents" })).toBeTruthy()
    expect(screen.getAllByRole("region", { name: "Incidents" })).toHaveLength(1)
  })

  it("opens a row's incident on a click or Enter and copies the incident's id", () => {
    const go = vi.fn<(intent: NavIntent) => void>()
    render(
      <TestViewHost tools={tools}>
        <NavProvider value={go}>
          <Widget data={CLUSTER as never} />
        </NavProvider>
      </TestViewHost>,
    )
    const row = screen.getByRole("row", { name: "Incident of instance ORDER-4711" })
    fireEvent.click(within(row).getByText("ORDER-4711"))
    fireEvent.keyDown(row, { key: "Enter" })
    const [first] = CLUSTER.incidents
    expect(go.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "incident-detail", incidentId: first.incidentId, label: undefined },
      { type: "incident-detail", incidentId: first.incidentId, label: undefined },
    ])
  })

  it("opens nothing from a row the engine reported without an incident id", () => {
    const go = vi.fn<(intent: NavIntent) => void>()
    const noIncidents: ClusterDetailData = {
      ...CLUSTER,
      incidents: CLUSTER.incidents.map((row) => ({ ...row, incidentId: "" })),
    }
    render(
      <TestViewHost tools={tools}>
        <NavProvider value={go}>
          <Widget data={noIncidents as never} />
        </NavProvider>
      </TestViewHost>,
    )
    fireEvent.click(screen.getByText("ORDER-4711"))
    expect(go).not.toHaveBeenCalled()
  })

  // #322 U12, U13: first seen is a point in time on the head's line, not a KPI tile; the
  // affected count is the KPI's alone.
  it("names the processes and the first sighting in the head's line, its instant in its title", () => {
    const named: ClusterDetailData = {
      ...CLUSTER,
      processDefinitionKeys: ["shipping", "returns"],
      process: null,
      incidents: CLUSTER.incidents.map((row) => ({
        ...row,
        processDefinitionName: "Ship order",
      })),
    }
    render(
      <TestViewHost>
        <Widget data={named as never} />
      </TestViewHost>,
    )

    expect(screen.getByText("in Ship order, returns")).toBeTruthy()
    const firstSeen = screen.getByText(/^first seen /)
    expect(firstSeen.textContent).toBe(
      `first seen ${formatRelativeTime("2026-06-11T08:00:00.000Z")}`,
    )
    expect(firstSeen.getAttribute("title")).toBe(formatInstant("2026-06-11T08:00:00.000Z"))
    expect(screen.queryByText(/affected ·/)).toBeNull()
    expect(screen.queryByText("First seen")).toBeNull()
    // Two processes: the rows say which one each incident's instance runs on, and the bar offers
    // no single process to open.
    expect(screen.getByText("Process", { selector: "th" })).toBeTruthy()
    expect(screen.getAllByText("Ship order")).toHaveLength(2)
    expect(screen.queryByRole("button", { name: "View process" })).toBeNull()
  })

  it("leaves the process column out when the cluster spans one process, which the bar opens", () => {
    const go = vi.fn<(intent: NavIntent) => void>()
    render(
      <TestViewHost>
        <NavProvider value={go}>
          <Widget data={CLUSTER as never} />
        </NavProvider>
      </TestViewHost>,
    )
    expect(screen.queryByText("Process", { selector: "th" })).toBeNull()
    expect(screen.getByText("in shipping")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "View process" }))
    expect(go).toHaveBeenCalledWith({
      type: "process-detail",
      processDefinitionKey: "shipping",
      label: undefined,
    })
  })

  it("opens no process the scan cannot name", () => {
    render(
      <TestViewHost>
        <Widget data={{ ...CLUSTER, processDefinitionKeys: ["(unknown)"], process: null }} />
      </TestViewHost>,
    )
    expect(screen.queryByRole("button", { name: "View process" })).toBeNull()
  })

  it("stamps when it was read at the bar's end, never among the facts", () => {
    const { container } = render(
      <TestViewHost>
        <Widget data={CLUSTER as never} />
      </TestViewHost>,
    )
    const stamp = container.querySelector('[data-slot="view-bar-freshness"]')
    expect(stamp?.textContent).toBe(
      `As of ${formatClock("2026-06-11T14:05:00.000Z", { seconds: false })}`,
    )
    expect(container.querySelector('[data-slot="view-bar-facts"]')?.textContent).not.toMatch(
      /As of/,
    )
  })

  it("shows a row's time as a clock without seconds, the whole instant in its title", () => {
    render(
      <TestViewHost>
        <Widget data={CLUSTER as never} />
      </TestViewHost>,
    )
    const row = screen.getByRole("row", { name: "Incident of instance ORDER-4711" })
    const time = within(row).getByTitle(formatInstant("2026-06-11T14:00:00.000Z"))
    expect(time.textContent).toBe(formatClock("2026-06-11T14:00:00.000Z", { seconds: false }))
  })

  it("says what the search finds: a business key or an id, or an id alone where no row has a key", () => {
    const { unmount } = render(
      <TestViewHost>
        <Widget data={CLUSTER as never} />
      </TestViewHost>,
    )
    expect(screen.getByRole("searchbox", { name: "Filter by business key or ID" })).toBeTruthy()
    unmount()
    const called: ClusterDetailData = {
      ...CLUSTER,
      incidents: CLUSTER.incidents.map((row) => ({ ...row, businessKey: null })),
    }
    render(
      <TestViewHost>
        <Widget data={called as never} />
      </TestViewHost>,
    )
    const search = screen.getByRole("searchbox", { name: "Filter by ID" })
    expect(search.getAttribute("placeholder")).toBe("Filter by ID…")
  })

  it("renders a cluster larger than the scan as a lower bound, its unknowns as —", () => {
    const capped: ClusterDetailData = {
      ...CLUSTER,
      incidentCount: null,
      scannedIncidentCount: 1000,
      lastHourCount: null,
      firstSeen: null,
      totalMatching: 1000,
    }
    render(
      <TestViewHost>
        <Widget data={capped as never} />
      </TestViewHost>,
    )

    // Never the scanned 1,000 passed off as the cluster's size, but a lower bound (counts
    // render in the runtime's locale; the matcher reads the no-break space as a space).
    const atLeast = `≥ ${formatNumber(1000)}`
    expect(screen.getByText(atLeast)).toBeTruthy()
    expect(screen.getByText("in shipping")).toBeTruthy()
    // The last hour's unknown count; no tile counts a day (Camunda 7 counts no root incidents in
    // a window).
    expect(screen.getAllByText("—")).toHaveLength(1)
    expect(screen.queryByText("New in 24h")).toBeNull()
    expect(screen.queryByText("0")).toBeNull()
    // A first sighting the scan cannot vouch for is left out, never guessed.
    expect(screen.queryByText(/^first seen /)).toBeNull()
    expect(
      screen.getByText(
        `The list covers the newest ${formatNumber(1000)} incidents of this cluster.`,
      ),
    ).toBeTruthy()
  })

  /** The KPI tile of a label: its figure, the tone of that figure and its words for a screen reader. */
  const affectedTile = (container: HTMLElement) => {
    const label = screen.getByText("Affected")
    // The label's caption row, then its cell.
    const tile = label.parentElement!.parentElement!
    const figure = tile.querySelector<HTMLElement>("[data-slot='count-figure']")!
    return {
      tone: figure.getAttribute("data-tone"),
      icon: figure.querySelector("svg") !== null,
      words: figure.querySelector(".sr-only")?.textContent ?? null,
      inside: container.contains(figure),
    }
  }

  it("alarms on an affected count while there are any, by the danger icon and its words", () => {
    const { container } = render(
      <TestViewHost>
        <Widget data={CLUSTER as never} />
      </TestViewHost>,
    )
    expect(affectedTile(container)).toEqual({
      tone: "danger",
      icon: true,
      words: "Has open incidents",
      inside: true,
    })
  })

  it("shows a cluster with nothing affected as a plain 0: no icon, no alarm words", () => {
    const gone: ClusterDetailData = {
      ...CLUSTER,
      incidentCount: 0,
      scannedIncidentCount: 0,
      lastHourCount: 0,
      incidents: [],
      totalMatching: 0,
    }
    const { container } = render(
      <TestViewHost>
        <Widget data={gone as never} />
      </TestViewHost>,
    )
    expect(affectedTile(container)).toEqual({
      tone: "neutral",
      icon: false,
      words: null,
      inside: true,
    })
  })
})

// #335 facts in #338's model context: a capped scan's count is a lower bound,
// counts it cannot vouch for are left out (never 0), the list's coverage said.
describe("describeCluster", () => {
  it("states an exact cluster as exact, with its whole list", () => {
    const text = bindHandOff("en").context(describeCluster(CLUSTER))
    expect(text).toContain('processDefinitionKey="shipping"')
    expect(text).toContain("On screen: incidentCount=40, lastHour=9, firstSeen=")
    expect(text).not.toMatch(/AtLeast|listCoversNewest|scannedProcessDefinitionKeys/)
  })

  it("states a capped cluster as at least its scanned share", () => {
    const text = bindHandOff("en").context(
      describeCluster({
        ...CLUSTER,
        incidentCount: null,
        scannedIncidentCount: 1000,
        lastHourCount: null,
        firstSeen: null,
      }),
    )
    // The keys are the scanned share's: a fact, never the scope (the rest of
    // the cluster may run on other processes).
    expect(text).toContain(
      'On screen: incidentCountAtLeast=1000, scannedProcessDefinitionKeys=["shipping"], latestIncident=',
    )
    expect(text).toContain("listCoversNewest=1000")
    expect(text).not.toMatch(/incidentCount=|lastHour|last24h|firstSeen|processDefinitionKey(In)?=/)
  })
})
