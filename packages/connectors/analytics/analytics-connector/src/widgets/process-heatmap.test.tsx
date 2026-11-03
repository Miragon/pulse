// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { HostWidgetSlot, TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import { ANALYTICS_BPMN_HEATMAP_DATA } from "../tool-names.js"
import {
  PROCESS_HEATMAP_LEGEND_WIDGET,
  PROCESS_HEATMAP_WIDGET,
  readProcessHeatmapProps,
} from "./process-heatmap.js"
import { analyticsHostWidgets } from "./views.js"

// The kit's viewer meets a diagram bpmn-js cannot import: the import-error alert is what the
// rendered heatmap shows here.
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

afterEach(cleanup)

/**
 * The props the engine module's process flow passes by raw id: this side of the contract that the
 * engine module's `process-definition-flow.test.tsx` pins from the other.
 */
function contractProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    processDefinitionKey: "leasing",
    engine: "prod-a",
    mode: "frequency",
    bpmnXml: "<definitions/>",
    onUnavailable: vi.fn(),
    ...overrides,
  }
}

const HEAT = { frequency: { assess: 4 }, durationMs: { assess: 1200 } }

function renderSlot(
  id: string,
  props: Record<string, unknown>,
  heatFeed: unknown = HEAT,
): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = []
  render(
    <TestViewHost
      tools={{
        [ANALYTICS_BPMN_HEATMAP_DATA]: (args: Record<string, unknown>) => {
          calls.push(args)
          if (heatFeed instanceof Error) throw heatFeed
          return heatFeed
        },
      }}
      hostWidgets={analyticsHostWidgets}
    >
      <HostWidgetSlot id={id} props={props} />
    </TestViewHost>,
  )
  return calls
}

describe("the host widget ids", () => {
  it("registers the heatmap and its legend under the ids the engine module renders", () => {
    expect(Object.keys(analyticsHostWidgets).sort()).toEqual([
      "analytics:engine-landscape",
      "analytics:process-heatmap",
      "analytics:process-heatmap-legend",
    ])
    expect([PROCESS_HEATMAP_WIDGET, PROCESS_HEATMAP_LEGEND_WIDGET]).toEqual([
      "analytics:process-heatmap",
      "analytics:process-heatmap-legend",
    ])
  })
})

describe("readProcessHeatmapProps (analytics:process-heatmap)", () => {
  it("reads exactly the contract: key, engine, mode, the diagram and the fallback", () => {
    const props = contractProps()
    expect(readProcessHeatmapProps(props)).toEqual(props)
    expect(readProcessHeatmapProps(contractProps({ mode: "duration" }))?.mode).toBe("duration")
    // The diagram is still loading, or the version has none.
    expect(readProcessHeatmapProps(contractProps({ bpmnXml: undefined }))?.bpmnXml).toBeUndefined()
    expect(readProcessHeatmapProps(contractProps({ bpmnXml: null }))?.bpmnXml).toBeNull()
  })

  it("passes the caller's fallback through, so its identity stays stable", () => {
    const props = contractProps()
    expect(readProcessHeatmapProps(props)?.onUnavailable).toBe(props.onUnavailable)
  })

  it.each([
    ["no key", { processDefinitionKey: undefined }],
    ["no engine", { engine: undefined }],
    ["an engine list", { engine: ["prod-a"] }],
    ["the incidents mode", { mode: "incidents" }],
    ["no fallback", { onUnavailable: undefined }],
    ["a diagram that is no text", { bpmnXml: 42 }],
  ])("refuses %s", (_case, overrides) => {
    expect(readProcessHeatmapProps(contractProps(overrides))).toBeNull()
  })
})

describe("analytics:process-heatmap", () => {
  it("reads the heat of the key on the one engine over 30 days, and draws it on the diagram", async () => {
    const calls = renderSlot(PROCESS_HEATMAP_WIDGET, contractProps())

    // The diagram bpmn-js cannot import: what happened, the parser's cause, what you can do.
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toBe(
      "The diagram could not be rendered" +
        "Open the model in your modeler and check it." +
        "Details" +
        "unparsable content <bpmn:foo> detected",
    )
    expect(calls).toEqual([{ processDefinitionKey: "leasing", period: "30d", engine: "prod-a" }])
  })

  it("waits for the caller's diagram", async () => {
    const calls = renderSlot(PROCESS_HEATMAP_WIDGET, contractProps({ bpmnXml: undefined }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(screen.getByText("Loading heatmap…")).toBeTruthy()
  })

  it("says when the version has no diagram", async () => {
    renderSlot(PROCESS_HEATMAP_WIDGET, contractProps({ bpmnXml: null }))
    expect(await screen.findByText("No diagram available for the heatmap.")).toBeTruthy()
  })

  it("reports a failing feed to the caller and renders nothing, so the caller hides the heat modes", async () => {
    const onUnavailable = vi.fn()
    renderSlot(PROCESS_HEATMAP_WIDGET, contractProps({ onUnavailable }), new Error("no tool"))
    await waitFor(() => expect(onUnavailable).toHaveBeenCalled())
    expect(screen.queryByText("Loading heatmap…")).toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("reads nothing for props outside the contract and reports to the caller's fallback, so a drifted caller shows its incidents again", async () => {
    const onUnavailable = vi.fn()
    const calls = renderSlot(
      PROCESS_HEATMAP_WIDGET,
      contractProps({ mode: "incidents", onUnavailable }),
    )
    await waitFor(() => expect(onUnavailable).toHaveBeenCalledTimes(1))
    expect(calls).toEqual([])
    expect(document.body.textContent).toBe("")
  })

  it("renders nothing for props outside the contract without a fallback to report to", async () => {
    const calls = renderSlot(PROCESS_HEATMAP_WIDGET, contractProps({ onUnavailable: "hide" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([])
    expect(document.body.textContent).toBe("")
  })
})

describe("analytics:process-heatmap-legend", () => {
  it.each([
    ["frequency", "Executions per element · 30 days"],
    ["duration", "Avg duration per element · 30 days"],
  ])("%s: the caption and the ramp from less to more", (mode, caption) => {
    renderSlot(PROCESS_HEATMAP_LEGEND_WIDGET, { mode })
    expect(document.body.textContent).toBe(`${caption}LessMore`)
  })

  it("renders nothing for another mode", () => {
    renderSlot(PROCESS_HEATMAP_LEGEND_WIDGET, { mode: "incidents" })
    expect(document.body.textContent).toBe("")
  })
})
