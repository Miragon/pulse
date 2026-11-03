// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { ENGINE_BPMN_XML_DATA, ENGINE_PROCESS_INCIDENTS_DATA } from "../tool-names.js"
import type { ProcessIncidentsData } from "../view-models.js"
import type * as DiagramModule from "./bpmn-diagram.js"
import {
  PROCESS_HEATMAP_LEGEND_WIDGET,
  PROCESS_HEATMAP_WIDGET,
  ProcessDefinitionFlow,
} from "./process-incidents/flow.js"
import type { DefinitionScope } from "./process-incidents/feed.js"
import { TestViewHost, createTestQueryClient } from "@miragon/pulse-widget-shell/widgets"

// One retry-free client per test; the test reads and pokes its cache.
let queryClient = createTestQueryClient()

// bpmn-js needs a real layout engine.
vi.mock("./bpmn-diagram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof DiagramModule>()),
  BpmnDiagram: () => <div data-testid="incident-overlay" />,
}))

// #341 N102: heatmap modes only once analytics is CONFIRMED active. Before, the overview opened in
// heatmap mode without analytics: ~7 s of loading and four failing calls instead of the overlay.

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

/**
 * Analytics' host widgets, as stubs that record their props: this side of the contract that
 * analytics' `process-heatmap.test.tsx` pins from the other.
 */
interface HostWidgetCalls {
  heatmap: Array<Record<string, unknown>>
  legend: Array<Record<string, unknown>>
}

function stubHostWidgets(calls: HostWidgetCalls) {
  return {
    [PROCESS_HEATMAP_WIDGET]: (props: Record<string, unknown>) => {
      calls.heatmap.push(props)
      return <div data-testid="heatmap-widget" />
    },
    [PROCESS_HEATMAP_LEGEND_WIDGET]: (props: Record<string, unknown>) => {
      calls.legend.push(props)
      return <div data-testid="heatmap-legend" />
    },
  }
}

function renderFlow(
  props: DefinitionScope,
  {
    analytics,
    widgets = [PROCESS_HEATMAP_WIDGET, PROCESS_HEATMAP_LEGEND_WIDGET],
    bpmnXml = "<definitions/>",
  }: { analytics: boolean; widgets?: readonly string[]; bpmnXml?: string | null },
): HostWidgetCalls {
  const calls: HostWidgetCalls = { heatmap: [], legend: [] }
  const tools: Record<string, unknown> = {
    [ENGINE_PROCESS_INCIDENTS_DATA]: DATA,
    [ENGINE_BPMN_XML_DATA]: { processDefinitionId: DATA.diagramDefinitionId, bpmnXml },
    ...(analytics ? { [ANALYTICS_PROBE]: { engines: [] } } : {}),
  }
  render(
    <TestViewHost
      tools={tools}
      client={queryClient}
      hostWidgets={Object.fromEntries(
        Object.entries(stubHostWidgets(calls)).filter(([id]) => widgets.includes(id)),
      )}
    >
      <ProcessDefinitionFlow {...props} />
    </TestViewHost>,
  )
  return calls
}

const modeGroup = () => screen.getByRole("group", { name: "Process flow display" })

/** Once the flow has loaded and the probe has offered the heat modes. */
async function chooseHeatMode(name: "Frequency" | "Duration") {
  const group = await screen.findByRole("group", { name: "Process flow display" })
  fireEvent.click(await within(group).findByRole("button", { name }))
}

async function probeSettled(status: "success" | "error") {
  await waitFor(() =>
    expect(
      queryClient.getQueryCache().find({ queryKey: ["analytics-probe"], exact: false })?.state
        .status,
    ).toBe(status),
  )
}

describe.each(ENTRIES)("definition view flow — %s", (_entry, props) => {
  it("without analytics: the incident overlay, no heatmap mode, no heatmap widget", async () => {
    const calls = renderFlow(props, { analytics: false })

    expect(await screen.findByTestId("incident-overlay")).toBeTruthy()
    // Let the probe fail and any stray query settle.
    await probeSettled("error")
    expect(within(modeGroup()).queryByRole("button", { name: "Frequency" })).toBeNull()
    expect(within(modeGroup()).queryByRole("button", { name: "Duration" })).toBeNull()
    expect(calls).toEqual({ heatmap: [], legend: [] })
  })

  it("with analytics: still leads with the overlay; the heatmap mounts only on request", async () => {
    const calls = renderFlow(props, { analytics: true })

    expect(await screen.findByTestId("incident-overlay")).toBeTruthy()
    const frequency = await within(modeGroup()).findByRole("button", { name: "Frequency" })
    expect(
      within(modeGroup()).getByRole("button", { name: "Incidents" }).getAttribute("aria-pressed"),
    ).toBe("true")
    expect(calls).toEqual({ heatmap: [], legend: [] })

    fireEvent.click(frequency)
    expect(await screen.findByTestId("heatmap-widget")).toBeTruthy()
    expect(screen.getByTestId("heatmap-legend")).toBeTruthy()
    expect(screen.queryByTestId("incident-overlay")).toBeNull()
  })
})

describe("definition view flow — the props it passes analytics' heatmap widgets", () => {
  const [, props] = ENTRIES[0]

  it("passes key, engine, mode, the drawn diagram and the fallback, and nothing else", async () => {
    const calls = renderFlow(props, { analytics: true })
    await chooseHeatMode("Frequency")

    await waitFor(() => expect(calls.heatmap.at(-1)?.bpmnXml).toBe("<definitions/>"))
    const passed = calls.heatmap.at(-1) ?? {}
    expect(Object.keys(passed).sort()).toEqual([
      "bpmnXml",
      "engine",
      "mode",
      "onUnavailable",
      "processDefinitionKey",
    ])
    const { onUnavailable, ...values } = passed
    expect(values).toEqual({
      processDefinitionKey: "leasing",
      // Without it the feed would aggregate across the whole fleet.
      engine: "prod-a",
      mode: "frequency",
      bpmnXml: "<definitions/>",
    })
    expect(typeof onUnavailable).toBe("function")
    // While the diagram loads it is undefined, never a guess.
    expect(
      calls.heatmap.every((p) => p.bpmnXml === undefined || p.bpmnXml === "<definitions/>"),
    ).toBe(true)
    expect(calls.legend.at(-1)).toEqual({ mode: "frequency" })

    await chooseHeatMode("Duration")
    await waitFor(() => expect(calls.heatmap.at(-1)?.mode).toBe("duration"))
    expect(calls.legend.at(-1)).toEqual({ mode: "duration" })
  })

  it("passes null for a version without a diagram", async () => {
    const calls = renderFlow(props, { analytics: true, bpmnXml: null })
    await chooseHeatMode("Frequency")
    await waitFor(() => expect(calls.heatmap.at(-1)?.bpmnXml).toBeNull())
  })

  it("falls back to the incidents and hides the heat modes once the widget reports the feed failed", async () => {
    const calls = renderFlow(props, { analytics: true })
    await chooseHeatMode("Frequency")
    await waitFor(() => expect(calls.heatmap.length).toBeGreaterThan(0))

    const onUnavailable = calls.heatmap[0].onUnavailable as () => void
    act(() => onUnavailable())

    expect(await screen.findByTestId("incident-overlay")).toBeTruthy()
    expect(screen.queryByTestId("heatmap-widget")).toBeNull()
    expect(within(modeGroup()).queryByRole("button", { name: "Frequency" })).toBeNull()
    expect(
      screen.getByText(/Could not load the heatmap\. Check that the analytics module is enabled\./),
    ).toBeTruthy()
  })

  it.each([
    ["both widgets", []],
    ["the legend", [PROCESS_HEATMAP_WIDGET]],
    ["the heatmap", [PROCESS_HEATMAP_LEGEND_WIDGET]],
  ])("offers no heat mode when the bundle lacks %s (fail-closed)", async (_case, widgets) => {
    const calls = renderFlow(props, { analytics: true, widgets })
    expect(await screen.findByTestId("incident-overlay")).toBeTruthy()
    await probeSettled("success")
    expect(within(modeGroup()).queryByRole("button", { name: "Frequency" })).toBeNull()
    expect(calls).toEqual({ heatmap: [], legend: [] })
  })
})
