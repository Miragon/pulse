// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import {
  ENGINE_ACTIVITY_STATISTICS_DATA,
  ENGINE_BPMN_XML_DATA,
  ENGINE_PROCESS_INCIDENTS_DATA,
} from "../tool-names.js"
import type { ActivityStatisticsData, ProcessIncidentsData } from "../view-models.js"
import type { DiagramCountKind, DiagramDecoration } from "@miragon/pulse-ui/bpmn"
import type * as DiagramModule from "./bpmn-diagram.js"
import { ProcessDefinitionFlow } from "./process-incidents/flow.js"
import type { DefinitionScope } from "./process-incidents/feed.js"
import {
  TestViewHost,
  createTestQueryClient,
  type HostAction,
} from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test.
let queryClient = createTestQueryClient()

// bpmn-js needs a real layout engine: the stub records what the flow asks it to draw.
const drawn: Array<{ definitionId: string; decorations: readonly DiagramDecoration[] }> = []
vi.mock("./bpmn-diagram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DiagramModule>()),
  BpmnDiagram: (props: { definitionId: string; decorations?: readonly DiagramDecoration[] }) => {
    drawn.push({ definitionId: props.definitionId, decorations: props.decorations ?? [] })
    return <div data-testid="diagram" data-definition={props.definitionId} />
  },
}))

afterEach(() => {
  cleanup()
  drawn.length = 0
  queryClient = createTestQueryClient()
})

const DATA: ProcessIncidentsData = {
  processDefinitionKey: "leasing",
  processDefinitionName: "Leasing",
  diagramVersion: 2,
  diagramDefinitionId: "leasing:2:d2",
  cockpitUrl: null,
  runningInstances: 4,
  incidentCount: 1,
  failedJobs: 1,
  totalActivityCount: 2,
  affectedDiagramActivityCount: 1,
  latestIncident: "2026-10-10T12:00:00.000+0000",
  activities: [
    {
      activityId: "assess",
      activityName: "Assess",
      representativeMessage: "assess failed",
      incidentCount: 1,
      firstSeen: null,
      latestIncident: "2026-10-10T12:00:00.000+0000",
    },
  ],
  siblingsWithIncidents: null,
  engineVendor: "CIB seven",
  engineId: "prod-a",
}

const RUNNING: ActivityStatisticsData = {
  processDefinitionKey: "leasing",
  source: "runtime",
  diagramDefinitionId: "leasing:2:d2",
  diagramVersion: 2,
  versionCount: 2,
  activities: [
    {
      activityId: "sendPolicy",
      activityName: "Send policy",
      inDiagram: true,
      running: 7,
      failedJobs: 0,
      incidents: 0,
      incidentsInCalledInstances: 0,
    },
    {
      activityId: "assess",
      activityName: "Assess",
      inDiagram: true,
      running: 3,
      failedJobs: 1,
      incidents: 1,
      incidentsInCalledInstances: 0,
    },
    // A call activity: its called instances' incidents apart, never its own.
    {
      activityId: "notify",
      activityName: null,
      inDiagram: true,
      running: 2,
      failedJobs: 2,
      incidents: 0,
      incidentsInCalledInstances: 2,
    },
    {
      activityId: "legacyCheck",
      activityName: "Legacy check",
      inDiagram: false,
      running: 1,
      failedJobs: 0,
      incidents: 0,
      incidentsInCalledInstances: 0,
    },
  ],
  engineId: "prod-a",
}

// The route scopes the flow; a drill reads the feed, a start view also hands it its seed.
const ROUTE = { processDefinitionKey: "leasing", engine: "prod-a" }
const ENTRIES: Array<[string, DefinitionScope]> = [
  ["cockpit drill", ROUTE],
  ["seeded process view", { ...ROUTE, data: DATA }],
]

function renderFlow(props: DefinitionScope, running: unknown = RUNNING) {
  const actions: HostAction[] = []
  const contexts: string[] = []
  render(
    <TestViewHost
      tools={{
        [ENGINE_PROCESS_INCIDENTS_DATA]: DATA,
        [ENGINE_BPMN_XML_DATA]: { processDefinitionId: DATA.diagramDefinitionId, bpmnXml: "<x/>" },
        [ENGINE_ACTIVITY_STATISTICS_DATA]: running,
      }}
      client={queryClient}
      onHostAction={(action) => actions.push(action)}
      onModelContext={(text) => contexts.push(text)}
    >
      <ProcessDefinitionFlow {...props} />
    </TestViewHost>,
  )
  const calls = (name: string) =>
    actions.flatMap((a) => (a.type === "callTool" && a.name === name ? [a.args] : []))
  return { actions, contexts, calls }
}

const modeGroup = () => screen.findByRole("radiogroup", { name: "Process flow display" })

async function chooseRunning() {
  fireEvent.click(within(await modeGroup()).getByRole("radio", { name: "Running" }))
}

const lastDrawn = () => drawn.at(-1)
/** The elements the diagram shows a count of `kind` on, with the count (none of 0). */
const countsOf = (kind: DiagramCountKind) =>
  (lastDrawn()?.decorations ?? []).flatMap(({ elementId, counts }) =>
    counts
      .filter((count) => count.kind === kind && count.count > 0)
      .map(({ count }) => ({ elementId, count })),
  )
/** The elements the diagram outlines for an own root incident. */
const outlined = () =>
  (lastDrawn()?.decorations ?? []).filter((d) => d.incident).map((d) => d.elementId)

describe.each(ENTRIES)("definition view flow: %s", (_entry, props) => {
  it("leads with the incidents and reads what runs only once Running is picked", async () => {
    const { calls } = renderFlow(props)

    expect(await screen.findByTestId("diagram")).toBeTruthy()
    const group = await modeGroup()
    expect(
      within(group).getByRole("radio", { name: "Incidents" }).getAttribute("aria-checked"),
    ).toBe("true")
    expect(countsOf("incidents")).toEqual([{ elementId: "assess", count: 1 }])
    expect(outlined()).toEqual(["assess"])
    expect(screen.getByText("diagram v2 (latest)")).toBeTruthy()
    expect(calls(ENGINE_ACTIVITY_STATISTICS_DATA)).toEqual([])

    await chooseRunning()
    await screen.findByText("diagram v2 (latest) · running now, counts span 2 versions")
    expect(calls(ENGINE_ACTIVITY_STATISTICS_DATA)).toEqual([
      { processDefinitionKey: "leasing", source: "runtime", engine: "prod-a" },
    ])
  })
})

describe("definition view flow: Running", () => {
  const [, props] = ENTRIES[0]

  it("draws each element's running count, its own root incidents and those of called instances apart", async () => {
    renderFlow(props)
    await chooseRunning()
    await screen.findByText(/running now/)

    expect(lastDrawn()?.definitionId).toBe("leasing:2:d2")
    expect(countsOf("running")).toEqual([
      { elementId: "sendPolicy", count: 7 },
      { elementId: "assess", count: 3 },
      { elementId: "notify", count: 2 },
      { elementId: "legacyCheck", count: 1 },
    ])
    expect(countsOf("incidents")).toEqual([{ elementId: "assess", count: 1 }])
    // Only an own root incident outlines an element: never what runs there, never a failed job
    // (the values per activity name notify's) or the incidents of the instances it called.
    expect(outlined()).toEqual(["assess"])
    // The incidents of the instances notify called: a quiet badge of their own.
    expect(countsOf("incidentsInCalledInstances")).toEqual([{ elementId: "notify", count: 2 }])
  })

  it("lists the values behind the badges, an element only older versions have marked", async () => {
    renderFlow(props)
    await chooseRunning()

    const table = await screen.findByRole("region", { name: "Values per activity" })
    const rows = within(table).getAllByRole("row").slice(1)
    // Running, incidents, incidents in called instances, jobs without retries.
    expect(rows.map((row) => row.textContent)).toEqual([
      "Send policy sendPolicy7000",
      "Assess assess3101",
      "notify2022",
      "Legacy check legacyCheck · only in older versions1000",
    ])
    // Its head beside the incidents', kept at every width: the quiet badge's words. A narrow
    // region drops the jobs without retries alone (their cells' rule, which happy-dom cannot
    // apply).
    expect(table.querySelector("thead")?.textContent).toContain("IncidentsIn called instances")
    const rules = table.closest("[data-list-table]")?.querySelector("style")?.textContent ?? ""
    expect(rules).not.toContain(":nth-child(4) { display: none; }")
    expect(rules).toContain(":nth-child(5) { display: none; }")
  })

  it("has no column for incidents in called instances where no element has one", async () => {
    renderFlow(props, {
      ...RUNNING,
      activities: RUNNING.activities.map((a) => ({ ...a, incidentsInCalledInstances: 0 })),
    })
    await chooseRunning()

    const table = await screen.findByRole("region", { name: "Values per activity" })
    expect(table.querySelector("thead")?.textContent).toBe(
      "ActivityRunningIncidentsJobs without retries",
    )
  })

  it("says so when nothing runs, and draws the diagram bare", async () => {
    renderFlow(props, { ...RUNNING, activities: [] })
    await chooseRunning()

    expect(
      await screen.findByText("No instance of this process is running right now."),
    ).toBeTruthy()
    expect(countsOf("running")).toEqual([])
    expect(screen.queryByRole("region", { name: "Values per activity" })).toBeNull()
  })

  it("shows a failed read with a retry and keeps the switch back to the incidents", async () => {
    let fail = true
    const { calls } = renderFlow(props, () => {
      if (fail) throw new Error("[503 ProcessEngineException] Engine is shutting down")
      return RUNNING
    })
    await chooseRunning()

    const retry = await screen.findByRole("button", { name: /try again|retry/i })
    fail = false
    fireEvent.click(retry)
    await screen.findByText(/running now/)
    expect(calls(ENGINE_ACTIVITY_STATISTICS_DATA)).toHaveLength(2)

    fireEvent.click(within(await modeGroup()).getByRole("radio", { name: "Incidents" }))
    await screen.findByText("diagram v2 (latest)")
  })

  it("tells the model the three elements with the most running, names fenced", async () => {
    const { contexts } = renderFlow(props)
    await chooseRunning()
    await waitFor(() => expect(contexts.at(-1)).toMatch(/runs at each activity/))

    const text = contexts.at(-1) ?? ""
    expect(text).toContain(
      'Ids: engine="prod-a", processDefinitionKey="leasing", diagramDefinitionId="leasing:2:d2"',
    )
    expect(text).toContain(
      'On screen: versions=2, diagramVersion=2, activitiesRunning=4, activitiesWithRootIncidents=1, activitiesWithIncidentsInCalledInstances=1, top1ActivityId="sendPolicy", top1Running=7, top2ActivityId="assess", top2Running=3, top3ActivityId="notify", top3Running=2',
    )
    expect(text).not.toContain("legacyCheck")
    expect(text).toMatch(/top1Name:\n```text\nSend policy\n```/)
  })

  it("renders no other module's widget and probes none", async () => {
    const { actions } = renderFlow(props)
    await chooseRunning()
    await screen.findByText(/running now/)

    const tools = actions.flatMap((a) => (a.type === "callTool" ? [a.name] : []))
    expect(tools.filter((name) => !name.startsWith("engine_"))).toEqual([])
  })
})
