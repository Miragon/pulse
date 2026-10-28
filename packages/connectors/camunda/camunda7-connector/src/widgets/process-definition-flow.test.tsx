// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ComponentType } from "react"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { queryClient } from "@miragon/mcp-toolkit-ui"
import { WidgetFixtureHost } from "@miragon/mcp-toolkit-ui/app"
import { collectLayoutWidgets, type LayoutConfig } from "@miragon/mcp-toolkit-core"
import { CAMUNDA7_BPMN_XML_DATA, CAMUNDA7_PROCESS_INCIDENTS_DATA } from "../tool-names.js"
import type { ProcessIncidentsData } from "../view-models.js"
import { definitionViewLayout } from "../widget-tools/shared.js"
import { cockpitViews } from "./cockpit-app/views.js"
import type * as DiagramModule from "./bpmn-diagram.js"
import { ProcessDefinitionFlow } from "./process-incidents/flow.js"

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
const ANALYTICS_PROBE = "analytics_settings_data"

const toolkitDefaults = queryClient.getDefaultOptions()

beforeEach(() => {
  queryClient.setDefaultOptions({
    ...toolkitDefaults,
    queries: { ...toolkitDefaults.queries, retry: false },
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  queryClient.setDefaultOptions(toolkitDefaults)
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

function flowProps(layout: LayoutConfig): Record<string, unknown> {
  expect(collectLayoutWidgets(layout)).toContain("camunda7:process-definition-flow")
  for (const row of layout as Array<{ row: Array<{ widget: string; props?: object }> }>) {
    const cell = row.row.find((c) => c.widget === "camunda7:process-definition-flow")
    if (cell) return { ...cell.props }
  }
  throw new Error("no flow cell")
}

// The show tool's cell props carry no scope; its widgets read the step data.
const ENTRIES: Array<[string, Record<string, unknown>]> = [
  [
    "cockpit overview drill",
    flowProps(
      cockpitViews["process-detail"]({ engine: "prod-a", processDefinitionKey: "leasing" }),
    ),
  ],
  [
    "cockpit incidents drill",
    flowProps(
      cockpitViews["process-detail"]({
        engine: "prod-a",
        processDefinitionKey: "leasing",
        focus: "incidents",
      }),
    ),
  ],
  [
    "camunda7_show_process_detail",
    { ...flowProps(definitionViewLayout()), processDefinitionKey: "leasing", engine: "prod-a" },
  ],
  [
    "camunda7_show_process_incidents",
    {
      ...flowProps(definitionViewLayout("incidents")),
      processDefinitionKey: "leasing",
      engine: "prod-a",
    },
  ],
]

function renderFlow(
  props: Record<string, unknown>,
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
      return { frequency: {}, durationSec: {} }
    },
    ...(analytics ? { [ANALYTICS_PROBE]: { settings: {}, canSave: false } } : {}),
  }
  const Flow: ComponentType<Record<string, unknown>> = () => <ProcessDefinitionFlow {...props} />
  render(<WidgetFixtureHost widget={Flow} data={{}} tools={tools} />)
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
