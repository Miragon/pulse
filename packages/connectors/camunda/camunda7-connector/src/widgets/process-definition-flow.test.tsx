// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { CAMUNDA7_BPMN_XML_DATA, CAMUNDA7_PROCESS_INCIDENTS_DATA } from "../tool-names.js"
import type { ProcessIncidentsData } from "../view-models.js"
import type * as DiagramModule from "./bpmn-diagram.js"
import { ProcessDefinitionFlow } from "./process-incidents/flow.js"
import type { DefinitionScope } from "./process-incidents/feed.js"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

// bpmn-js needs a real layout engine.
vi.mock("./bpmn-diagram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DiagramModule>()),
  BpmnDiagram: () => <div data-testid="incident-overlay" />,
}))

// An unimportable diagram: the import-error alert is what the last suite reads.
const viewer = vi.hoisted(() => ({
  MockViewer: class {
    importXML(): Promise<never> {
      return Promise.reject(new Error("unparsable content <bpmn:foo> detected"))
    }
    get(): unknown {
      return { zoom: () => 1 }
    }
    destroy() {}
  },
}))
vi.mock("bpmn-js/lib/NavigatedViewer", () => ({ default: viewer.MockViewer }))

// #341 N102: heatmap modes only once analytics is CONFIRMED active. Before, the overview opened in
// heatmap mode without analytics: ~7 s of loading and four failing calls instead of the overlay.

const HEATMAP_FEED = "analytics_bpmn_heatmap_data"
const ANALYTICS_PROBE = "analytics_engine_landscape_data"

afterEach(() => {
  cleanup()
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
  last24hCount: 1,
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

// The route scopes the flow; a drill reads the feed, a start view also hands it its seed.
const ROUTE = { processDefinitionKey: "leasing", engine: "prod-a" }
const ENTRIES: Array<[string, DefinitionScope]> = [
  ["cockpit drill", ROUTE],
  ["seeded process view", { ...ROUTE, data: DATA }],
]

function renderFlow(
  props: DefinitionScope,
  { analytics, bpmnXml = "<definitions/>" }: { analytics: boolean; bpmnXml?: string },
) {
  const heatmapCalls: Array<Record<string, unknown>> = []
  const tools: Record<string, unknown> = {
    [CAMUNDA7_PROCESS_INCIDENTS_DATA]: DATA,
    [CAMUNDA7_BPMN_XML_DATA]: { processDefinitionId: DATA.diagramDefinitionId, bpmnXml },
    // Registered either way so a call is RECORDED; without analytics it fails like an unknown tool.
    [HEATMAP_FEED]: (args: Record<string, unknown>) => {
      heatmapCalls.push(args)
      if (!analytics) throw new Error(`Tool ${HEATMAP_FEED} not found`)
      return { frequency: {}, durationMs: {} }
    },
    ...(analytics ? { [ANALYTICS_PROBE]: { engines: [] } } : {}),
  }
  render(
    <TestViewHost tools={tools} client={queryClient}>
      <ProcessDefinitionFlow {...props} />
    </TestViewHost>,
  )
  return heatmapCalls
}

const modeGroup = () => screen.getByRole("group", { name: "Process flow display" })

describe.each(ENTRIES)("definition view flow — %s", (_entry, props) => {
  it("without analytics: the incident overlay, no heatmap mode, no heatmap call", async () => {
    const heatmapCalls = renderFlow(props, { analytics: false })

    expect(await screen.findByTestId("incident-overlay")).toBeTruthy()
    // Let the probe fail and any stray query settle.
    await waitFor(() =>
      expect(
        queryClient.getQueryCache().find({ queryKey: ["analytics-probe"], exact: false })?.state
          .status,
      ).toBe("error"),
    )
    expect(within(modeGroup()).queryByRole("button", { name: "Frequency" })).toBeNull()
    expect(within(modeGroup()).queryByRole("button", { name: "Duration" })).toBeNull()
    expect(screen.queryByText("Loading heatmap…")).toBeNull()
    expect(heatmapCalls).toEqual([])
  })

  it("with analytics: still leads with the overlay; the heatmap loads only on request", async () => {
    const heatmapCalls = renderFlow(props, { analytics: true })

    expect(await screen.findByTestId("incident-overlay")).toBeTruthy()
    const frequency = await within(modeGroup()).findByRole("button", { name: "Frequency" })
    expect(
      within(modeGroup()).getByRole("button", { name: "Incidents" }).getAttribute("aria-pressed"),
    ).toBe("true")
    expect(heatmapCalls).toEqual([])

    fireEvent.click(frequency)
    await waitFor(() => expect(heatmapCalls).toHaveLength(1))
    expect(heatmapCalls[0]).toMatchObject({ processDefinitionKey: "leasing", engine: "prod-a" })
  })
})

describe("definition view flow — a heatmap diagram bpmn-js cannot import", () => {
  it("says what happened, the parser's cause, and what you can do", async () => {
    const [, props] = ENTRIES[0]
    renderFlow(props, { analytics: true, bpmnXml: "<broken/>" })
    expect(await screen.findByTestId("incident-overlay")).toBeTruthy()
    fireEvent.click(await within(modeGroup()).findByRole("button", { name: "Frequency" }))

    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(
      "The diagram could not be rendered" +
        "Open the model in your modeler and check it." +
        "Details" +
        "unparsable content <bpmn:foo> detected",
    )
  })
})
