// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { formatTime } from "@miragon/pulse-ui"
import {
  ENGINE_ACTIVITY_STATISTICS_DATA,
  ENGINE_BPMN_XML_DATA,
  ENGINE_PROCESS_INCIDENTS_DATA,
} from "../tool-names.js"
import type { ActivityThroughputData, ProcessIncidentsData } from "../view-models.js"
import type * as DiagramModule from "./bpmn-diagram.js"
import type * as HeatModule from "./process-incidents/heat/heat-diagram.js"
import { ProcessDefinitionFlow } from "./process-incidents/flow.js"
import { refreshCockpitData } from "./refresh.js"
import {
  TestViewHost,
  createTestQueryClient,
  createViewQueryClient,
  type HostAction,
  type QueryClient,
} from "@miragon/pulse-widget-shell/widgets"

// bpmn-js needs a real layout engine: the stubs record what the flow asks them to draw.
const heat: Array<{ bpmnXml: string; values: Readonly<Record<string, number>> }> = []
vi.mock("./bpmn-diagram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DiagramModule>()),
  BpmnDiagram: () => <div data-testid="diagram" />,
}))
vi.mock("./process-incidents/heat/heat-diagram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof HeatModule>()),
  BpmnHeatmap: (props: { bpmnXml: string; values: Readonly<Record<string, number>> }) => {
    heat.push(props)
    return <div data-testid="heat" />
  },
}))

let queryClient: QueryClient = createTestQueryClient()
afterEach(() => {
  cleanup()
  heat.length = 0
  queryClient = createTestQueryClient()
})

const DATA: ProcessIncidentsData = {
  processDefinitionKey: "leasing",
  processDefinitionName: "Leasing",
  diagramVersion: 2,
  diagramDefinitionId: "leasing:2:d2",
  cockpitUrl: null,
  runningInstances: 4,
  incidentCount: 0,
  last24hCount: 0,
  failedJobs: 0,
  totalActivityCount: 2,
  affectedDiagramActivityCount: 0,
  latestIncident: null,
  activities: [],
  siblingsWithIncidents: null,
  engineVendor: "CIB seven",
  engineId: "prod-a",
}

const THROUGHPUT: ActivityThroughputData = {
  processDefinitionKey: "leasing",
  source: "history",
  diagramDefinitionId: "leasing:2:d2",
  diagramVersion: 2,
  versionCount: 3,
  versionsRead: 2,
  startedAfter: "2026-10-09T11:00:00.000Z",
  windowDays: 30,
  cappedByHistoryTimeToLive: false,
  instanceCount: 1234,
  uncountedInstances: 0,
  historyRecorded: true,
  readAt: "2026-11-08T10:30:00.000Z",
  activities: [
    {
      activityId: "assess",
      activityName: "Assess",
      inDiagram: true,
      passed: 1300,
      running: 4,
      canceled: 12,
    },
    {
      activityId: "sendPolicy",
      activityName: null,
      inDiagram: true,
      passed: 1100,
      running: 0,
      canceled: 0,
    },
    {
      activityId: "legacyCheck",
      activityName: "Legacy check",
      inDiagram: false,
      passed: 40,
      running: 0,
      canceled: 3,
    },
    // Reached so far, never passed: a row, but no heat.
    {
      activityId: "review",
      activityName: "Review",
      inDiagram: true,
      passed: 0,
      running: 2,
      canceled: 0,
    },
  ],
  engineId: "prod-a",
}

const ROUTE = { processDefinitionKey: "leasing", engine: "prod-a" }

function renderFlow(throughput: unknown = THROUGHPUT, client: QueryClient = queryClient) {
  const actions: HostAction[] = []
  const contexts: string[] = []
  render(
    <TestViewHost
      tools={{
        [ENGINE_PROCESS_INCIDENTS_DATA]: DATA,
        [ENGINE_BPMN_XML_DATA]: { processDefinitionId: DATA.diagramDefinitionId, bpmnXml: "<x/>" },
        [ENGINE_ACTIVITY_STATISTICS_DATA]: throughput,
      }}
      client={client}
      onHostAction={(action) => actions.push(action)}
      onModelContext={(text) => contexts.push(text)}
    >
      <ProcessDefinitionFlow {...ROUTE} />
    </TestViewHost>,
  )
  const reads = () =>
    actions.flatMap((a) =>
      a.type === "callTool" && a.name === ENGINE_ACTIVITY_STATISTICS_DATA ? [a.args] : [],
    )
  return { contexts, reads }
}

const modeGroup = () => screen.findByRole("radiogroup", { name: "Process flow display" })
const pick = async (name: string) =>
  fireEvent.click(within(await modeGroup()).getByRole("radio", { name }))

const CAPTION = /1,234 instances started since/

describe("definition view flow: Throughput", () => {
  it("is not the default and reads the engine's history only once picked", async () => {
    const { reads } = renderFlow()
    const group = await modeGroup()
    expect(
      within(group)
        .getAllByRole("radio")
        .map((b) => b.textContent),
    ).toEqual(["Incidents", "Running", "Throughput · 30 days"])
    expect(reads()).toEqual([])

    await pick("Throughput · 30 days")
    await screen.findByText(CAPTION)
    expect(reads()).toEqual([
      { processDefinitionKey: "leasing", source: "history", engine: "prod-a" },
    ])
  })

  it("paints what the window's instances passed on the latest diagram, and names the cohort", async () => {
    renderFlow()
    await pick("Throughput · 30 days")

    expect(await screen.findByText(CAPTION)).toBeTruthy()
    expect(screen.getByText(CAPTION).textContent).toMatch(
      /^diagram v2 \(latest\) · 1,234 instances started since .+, .+, on 2 versions$/,
    )
    // The window starts on the hour, not at midnight: the caption says when.
    expect(screen.getByText(CAPTION).textContent).toContain(
      `, ${formatTime(THROUGHPUT.startedAfter, { seconds: false })}, on 2 versions`,
    )
    // legacyCheck is only in an older version: a value, but no heat on this diagram; review has
    // instances running there and none passed yet.
    await waitFor(() =>
      expect(heat.at(-1)).toEqual({
        bpmnXml: "<x/>",
        values: { assess: 1300, sendPolicy: 1100 },
        ariaLabel: "BPMN process diagram with the throughput as heat",
      }),
    )
    expect(
      screen.getByText(
        /Read from the engine's history \(history level activity or higher\) at .+, kept for an hour\./,
      ),
    ).toBeTruthy()
    // The legend's ends are the values the ramp encodes.
    expect(screen.getByText("1,100 to 1,300")).toBeTruthy()
  })

  it("lists the values behind the colours, an element only older versions have marked", async () => {
    renderFlow()
    await pick("Throughput · 30 days")

    const table = await screen.findByRole("region", { name: "Values per activity" })
    expect(
      within(table)
        .getAllByRole("row")
        .map((row) => row.textContent),
    ).toEqual([
      "ActivityPassesRunningCancelled",
      "Assess assess1,300412",
      "sendPolicy1,10000",
      "Legacy check legacyCheck · only in older versions4003",
      "Review review020",
    ])
  })

  it("says when a version's history time to live cut the window", async () => {
    renderFlow({ ...THROUGHPUT, windowDays: 7, cappedByHistoryTimeToLive: true })
    await pick("Throughput · 30 days")

    expect(
      await screen.findByText(
        /The window covers only 7 days: the engine keeps the history that long\./,
      ),
    ).toBeTruthy()
  })

  it("says how many instances started on versions it did not count", async () => {
    renderFlow({ ...THROUGHPUT, uncountedInstances: 3 })
    await pick("Throughput · 30 days")

    expect(
      await screen.findByText(
        /Not counted: 3 instances started in the window on older or no longer deployed versions\./,
      ),
    ).toBeTruthy()
  })

  it("says the engine keeps no history of the process when a time to live of 0 days leaves no window", async () => {
    renderFlow({
      ...THROUGHPUT,
      windowDays: 0,
      cappedByHistoryTimeToLive: true,
      versionsRead: 0,
      instanceCount: 0,
      activities: [],
    })
    await pick("Throughput · 30 days")

    expect(
      await screen.findByText(
        "The engine keeps no history of this process (a history time to live of 0 days), so there is no throughput to show.",
      ),
    ).toBeTruthy()
    expect(heat).toEqual([])
    expect(screen.queryByRole("region", { name: "Values per activity" })).toBeNull()
  })

  it("says the engine records no history instead of drawing a cold diagram", async () => {
    renderFlow({
      ...THROUGHPUT,
      historyRecorded: false,
      versionsRead: 0,
      instanceCount: 0,
      activities: [],
    })
    await pick("Throughput · 30 days")

    expect(
      await screen.findByText(
        "This engine records no history. Throughput needs history level activity or higher.",
      ),
    ).toBeTruthy()
    expect(heat).toEqual([])
  })

  it("says so when no instance started in the window", async () => {
    renderFlow({
      ...THROUGHPUT,
      historyRecorded: null,
      versionsRead: 0,
      instanceCount: 0,
      activities: [],
    })
    await pick("Throughput · 30 days")

    expect(
      await screen.findByText(/^No instance of this process started since .+, .+\.$/),
    ).toBeTruthy()
    expect(screen.queryByRole("region", { name: "Values per activity" })).toBeNull()
  })

  // The read loads the engine's database: the cockpit's Refresh never repeats it.
  it("stays out of the cockpit's Refresh", async () => {
    const { reads } = renderFlow()
    await pick("Throughput · 30 days")
    await screen.findByText(CAPTION)

    await refreshCockpitData(queryClient)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(reads()).toHaveLength(1)
  })

  // A timed-out read keeps running in the engine's database: no automatic second one.
  it("never retries a failed read on its own, only on the button", async () => {
    let fail = true
    const { reads } = renderFlow(() => {
      if (fail) throw new Error("[504 ProcessEngineException] The request timed out")
      return THROUGHPUT
    }, createViewQueryClient())
    await pick("Throughput · 30 days")

    const retry = await screen.findByRole("button", { name: /try again|retry/i })
    expect(reads()).toHaveLength(1)
    fail = false
    fireEvent.click(retry)
    await screen.findByText(CAPTION)
    expect(reads()).toHaveLength(2)
  })

  it("tells the model the window and the three elements passed most, names fenced", async () => {
    const { contexts } = renderFlow()
    await pick("Throughput · 30 days")
    await waitFor(() => expect(contexts.at(-1)).toMatch(/started in the window passed/))

    const text = contexts.at(-1) ?? ""
    expect(text).toContain(
      'Ids: engine="prod-a", processDefinitionKey="leasing", diagramDefinitionId="leasing:2:d2"',
    )
    expect(text).toContain(
      'On screen: startedAfter="2026-10-09T11:00:00.000Z", windowDays=30, windowCutByHistoryTimeToLive=false, instancesStarted=1234, instancesNotCounted=0, versionsRead=2, diagramVersion=2, historyRecorded=true, readAt="2026-11-08T10:30:00.000Z", top1ActivityId="assess", top1Passed=1300, top1Running=4, top2ActivityId="sendPolicy", top2Passed=1100, top2Running=0, top3ActivityId="legacyCheck", top3Passed=40, top3Running=0',
    )
    expect(text).toMatch(/top1Name:\n```text\nAssess\n```/)
  })
})
