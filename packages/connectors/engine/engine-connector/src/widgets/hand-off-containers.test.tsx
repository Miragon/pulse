// @vitest-environment happy-dom
import type { ReactElement } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { TestViewHost, type FollowUp } from "@miragon/pulse-widget-shell/widgets"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../tool-names.js"
import type {
  ClusterDetailData,
  HistoryTimelineData,
  IncidentInstance,
  IncidentsDashboardData,
  JobPanelData,
} from "../view-models.js"
import { ClusterDetailWidget } from "./cluster-detail.js"
import { HistoryTimelineWidget } from "./history-timeline.js"
import { IncidentsBar } from "./incidents-dashboard/incidents-bar.js"
import { VariablesTab } from "./instance-detail/variables-tab.js"
import { JobPanelWidget } from "./job-panel.js"
import { IncidentTable } from "./process-incidents/incident-table.js"
import { useIncidentRecovery } from "./process-incidents/use-incident-recovery.js"
import { InstancesHeader } from "./process-instances/list-header.js"

/**
 * A menu, a row or a view's bar that holds hand-offs alone shows only where the host shows a
 * hand-off: a page outside a chat that hides them (`followUp` "none") gets no empty menu, no
 * empty row and no empty action group, and an entry of another kind keeps its menu.
 */

afterEach(cleanup)

const MENU = "More actions for this incident"

function incident(id: string, cockpitInstanceUrl: string | null): IncidentInstance {
  return {
    id,
    processInstanceId: `pi-${id}`,
    incidentType: "failedJob",
    incidentMessage: `message ${id}`,
    incidentTimestamp: "2026-10-09T09:30:00.000+0000",
    activityId: "charge",
    activityName: null,
    cockpitInstanceUrl,
    businessKey: null,
    recovery: { action: "none" },
  }
}

const INCIDENTS = [
  incident("linked", "https://engine.example/camunda/app/cockpit/#/process-instance/pi-linked"),
  incident("bare", null),
]

function Incidents() {
  const recovery = useIncidentRecovery("prod", { resetOn: INCIDENTS })
  return (
    <IncidentTable
      incidents={INCIDENTS}
      recovery={recovery}
      onAnalyze={() => {}}
      engine="prod"
      vendor="CIB seven"
    />
  )
}

async function menuOf(followUp: FollowUp, id: string) {
  render(
    <TestViewHost followUp={followUp}>
      <Incidents />
    </TestViewHost>,
  )
  const row = (await screen.findByText(`message ${id}`)).closest("tr")!
  return within(row).queryByRole("button", { name: MENU })
}

function entriesOf(menu: HTMLElement): HTMLElement[] {
  fireEvent.click(menu)
  return within(screen.getByRole("menu", { name: MENU })).getAllByRole("menuitem")
}

describe("an incident row's menu", () => {
  it("shows none where its one entry would be a hand-off the host hides", async () => {
    expect(await menuOf("none", "bare")).toBeNull()
  })

  it("holds the engine's link alone where the host hides hand-offs", async () => {
    const entries = entriesOf((await menuOf("none", "linked"))!)
    expect(entries.map((entry) => entry.tagName)).toEqual(["A"])
  })

  it("holds the hand-off where the host copies its prompt", async () => {
    const entries = entriesOf((await menuOf("copy", "bare"))!)
    expect(entries.map((entry) => entry.textContent)).toEqual(["Copy prompt: Draft ticket in chat"])
  })
})

describe("the variables tab", () => {
  function renderTab(followUp: FollowUp) {
    render(
      <TestViewHost followUp={followUp}>
        <div data-testid="tab">
          <VariablesTab
            variables={{}}
            instanceId="pi-1"
            definitionId="invoice:1:abc"
            engineId="prod"
            readOnly
          />
        </div>
      </TestViewHost>,
    )
    return screen.getByTestId("tab")
  }

  it("starts with its table where the host hides hand-offs, no empty row above it", () => {
    expect(renderTab("none").childElementCount).toBe(1)
  })

  it("leads with its hand-off in a chat", () => {
    const tab = renderTab("chat")
    expect(tab.childElementCount).toBe(2)
    expect(within(tab).getByRole("button", { name: "Check variables in chat" })).toBeTruthy()
  })
})

const DASHBOARD: IncidentsDashboardData = {
  totalCount: 3,
  processCount: 1,
  fetchedAt: "2026-10-26T08:00:00.000Z",
  affectedActivityCount: 1,
  latestIncident: null,
  processes: [],
  filters: {},
  engineVendor: "CIB seven",
  engineId: "prod",
}

const JOBS: JobPanelData = {
  totalCount: 1,
  allCount: 1,
  failedCount: 1,
  fetchedAt: "2026-10-26T08:00:00.000Z",
  jobs: [
    {
      id: "job-1",
      processInstanceId: "pi-1",
      processDefinitionKey: "invoice",
      processDefinitionId: "invoice:1:abc",
      processDefinitionName: "Invoice Receipt",
      activityId: "chargeCard",
      activityName: "Charge card",
      retries: 0,
      exceptionMessage: "Card declined",
      dueDate: null,
      suspended: false,
      priority: 0,
      createTime: "2026-06-11T08:00:00.000Z",
    },
  ],
  filters: {},
  engineId: "prod",
}

const HISTORY: HistoryTimelineData = {
  processInstance: {
    id: "pi-1",
    processDefinitionKey: "invoice",
    processDefinitionName: "Invoice Receipt",
    startTime: "2026-01-01T10:00:00.000Z",
    endTime: null,
    durationInMillis: null,
    state: "ACTIVE",
  },
  activities: [],
  totalActivities: 0,
  incidentActivityIds: null,
  engineId: "prod",
}

const CLUSTER: ClusterDetailData = {
  activityId: "callWMS",
  activityName: "Call WMS",
  incidentType: "failedExternalTask",
  messageSignature: "connection timeout",
  incidentCount: 2,
  scannedIncidentCount: 2,
  lastHourCount: 1,
  firstSeen: null,
  latestIncident: null,
  // Two processes: no single one for the bar to open, so its one action is the hand-off.
  processDefinitionKeys: ["shipping", "returns"],
  representativeMessage: "Connection timeout",
  incidents: [],
  totalMatching: 0,
  fetchedAt: "2026-06-11T14:05:00.000Z",
  engineId: "prod",
}

/** Each view whose bar holds one action, its hand-off. */
const BARS: ReadonlyArray<[view: string, bar: ReactElement]> = [
  ["the incidents' bar", <IncidentsBar key="bar" data={DASHBOARD} engine="prod" />],
  ["the jobs", <JobPanelWidget key="jobs" data={JOBS} engine="prod" />],
  [
    "the instance list",
    <InstancesHeader
      key="instances"
      title="Running instances"
      processName={null}
      scopedKey={null}
      total={3}
      engine="prod"
      filters={{}}
      fetchedAt="2026-10-26T08:00:00.000Z"
    />,
  ],
  [
    "an instance's history",
    <HistoryTimelineWidget key="history" data={HISTORY} processInstanceId="pi-1" engine="prod" />,
  ],
  [
    "an incident cluster",
    <ClusterDetailWidget
      key="cluster"
      data={CLUSTER}
      engine="prod"
      activityId="callWMS"
      incidentType="failedExternalTask"
    />,
  ],
]

/** No write is offered, so a bar holds its hand-off alone. */
const NO_WRITES = { [ENGINE_WIDGET_ACTIONS_DATA]: { allowedActions: [], readOnlyEngines: [] } }

function barOf(followUp: FollowUp, view: ReactElement) {
  const { container } = render(
    <TestViewHost tools={NO_WRITES} followUp={followUp}>
      {view}
    </TestViewHost>,
  )
  const bar = container.querySelector<HTMLElement>('[data-slot="view-bar"]')
  expect(bar).not.toBeNull()
  return bar!
}

describe("a view's bar whose one action is a hand-off", () => {
  it.each(BARS)("%s: draws no action group where the host hides hand-offs", (_, view) => {
    const bar = barOf("none", view)
    expect(bar.querySelector('[data-slot="view-bar-actions"]')).toBeNull()
    expect(within(bar).queryByRole("button")).toBeNull()
  })

  it.each(BARS)("%s: holds the hand-off in its group in a chat", (_, view) => {
    const bar = barOf("chat", view)
    const group = bar.querySelector<HTMLElement>('[data-slot="view-bar-actions"]')
    expect(
      within(group!)
        .getAllByRole("button")
        .map((button) => button.title),
    ).toEqual([expect.stringMatching(/in chat$/)])
  })
})
