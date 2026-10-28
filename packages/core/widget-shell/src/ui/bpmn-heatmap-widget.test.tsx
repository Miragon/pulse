// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LocaleProvider } from "@miragon/mcp-toolkit-ui"
import { setFormatLocale } from "../testing/index.js"
import { BpmnHeatmap, HeatmapLegend } from "./bpmn-heatmap.js"
import { BpmnHeatmapWidget, HeatValuesTable, type BpmnHeatmapData } from "./bpmn-heatmap-widget.js"

// bpmn-js needs a real SVG engine; a stub that imports any diagram 4:1 wide.
const viewer = vi.hoisted(() => ({
  fail: false,
  MockViewer: class {
    importXML(): Promise<unknown> {
      return viewer.fail ? Promise.reject(new Error("unparsable <bpmn:x>")) : Promise.resolve({})
    }
    get(service: string): unknown {
      if (service === "canvas") {
        return {
          zoom: () => 1,
          resized: () => {},
          viewbox: () => ({
            x: 0,
            y: 0,
            width: 800,
            height: 200,
            scale: 1,
            inner: { x: 0, y: 0, width: 800, height: 200 },
          }),
        }
      }
      if (service === "elementRegistry") return { getAll: () => [] }
      return { on() {}, off() {} }
    }
    destroy() {}
  },
}))
vi.mock("bpmn-js/lib/NavigatedViewer", () => ({ default: viewer.MockViewer }))

afterEach(() => {
  cleanup()
  viewer.fail = false
  setFormatLocale(undefined)
})

const XML = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d">
  <bpmn:process id="order">
    <bpmn:serviceTask id="Task_A" name="Ship order" />
    <bpmn:userTask id="Task_B" name="Approve order" />
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`

const DATA: BpmnHeatmapData = {
  processDefinitionKey: "order",
  bpmnXml: XML,
  period: "7d",
  frequency: { Task_A: 1234, Task_B: 3, End: 0 },
  durationSec: { Task_A: 187, Task_B: 2 },
}

describe("BpmnHeatmapWidget (U16)", () => {
  beforeEach(() => setFormatLocale({ language: "en", locale: "en-US" }))

  it("names the process by its model's name, the key quiet beside it (U13)", () => {
    const named = XML.replace('<bpmn:process id="order">', '<bpmn:process id="order" name="Order">')
    render(<BpmnHeatmapWidget data={{ ...DATA, bpmnXml: named }} />)
    const heading = screen.getByRole("heading", { level: 2 })
    expect(heading.textContent).toMatch(/Orderorder$/)
    expect(screen.getByText("order").className).toContain("font-mono")
    cleanup()
    // Without a name the key is the badge, in mono.
    render(<BpmnHeatmapWidget data={DATA} />)
    const badge = screen.getByText("order")
    expect(badge.className).toContain("font-mono")
    expect(badge.getAttribute("data-slot")).toBe("badge")
  })

  // The Camunda Modeler names the pool and leaves the process unnamed.
  it("names a process without a name of its own by its pool, like the other views", () => {
    const pooled = XML.replace(
      "<bpmn:process",
      '<bpmn:collaboration id="c"><bpmn:participant id="Pool" name="Order handling" processRef="order"/></bpmn:collaboration><bpmn:process',
    )
    render(<BpmnHeatmapWidget data={{ ...DATA, bpmnXml: pooled }} />)
    const heading = screen.getByRole("heading", { level: 2 })
    expect(heading.textContent).toMatch(/Order handlingorder$/)
  })

  it("says what the colours mean: the legend runs from the smallest value to the largest", () => {
    render(<BpmnHeatmapWidget data={DATA} />)
    expect(screen.getByText("3 to 1,234").className).toContain("sr-only")
    const legend = screen.getByText("3 to 1,234").parentElement!
    const visible = [...legend.querySelectorAll("[aria-hidden]")].map((el) => el.textContent)
    expect(visible).toEqual(["3", "", "1,234"])
  })

  it("lists the value per element, named from the diagram, largest first", () => {
    render(<BpmnHeatmapWidget data={DATA} />)
    const summary = screen.getByText("Values per element")
    expect(summary.closest("details")).toBeTruthy()
    const table = screen.getByRole("table", { name: "Values per element" })
    const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => tr.textContent)
    // Zero-valued elements stay out; names first, the id quiet beside them.
    expect(rows).toEqual(["Ship orderTask_A1,234", "Approve orderTask_B3"])
  })

  it("switches the metric with a segmented control; durations read as durations", () => {
    setFormatLocale({ language: "de", locale: "de-DE" })
    render(
      <LocaleProvider locale="de">
        <BpmnHeatmapWidget data={DATA} />
      </LocaleProvider>,
    )
    const group = screen.getByRole("group", { name: "Kennzahl" })
    const duration = screen.getByRole("button", { name: "Duration" })
    expect(group.contains(duration)).toBe(true)
    fireEvent.click(duration)
    expect(duration.getAttribute("aria-pressed")).toBe("true")
    // (getByText collapses the non-breaking spaces between number and unit.)
    expect(screen.getByText("2 s bis 3 Min. 7 s").className).toContain("sr-only")
  })

  it("heads the view with a 28 px h2 title and keeps the paper light", () => {
    const { container } = render(<BpmnHeatmapWidget data={DATA} />)
    const heading = screen.getByRole("heading", { level: 2 })
    expect(heading.textContent).toContain("BPMN heatmap")
    expect(heading.className).toContain("text-title")
    const frame = container.querySelector('[role="img"]')?.parentElement
    expect(frame?.getAttribute("data-theme-mode")).toBe("light")
  })

  it("says so in an empty state without data or a diagram", () => {
    const { rerender } = render(<BpmnHeatmapWidget data={null} />)
    expect(screen.getByText("No heatmap data.").closest("[data-empty-variant]")).toBeTruthy()
    rerender(<BpmnHeatmapWidget data={{ ...DATA, bpmnXml: null }} />)
    expect(screen.getByText(/The BPMN diagram is not available/)).toBeTruthy()
  })
})

describe("BpmnHeatmap", () => {
  it("sizes its frame from the diagram unless given a height", () => {
    const { container, rerender } = render(<BpmnHeatmap bpmnXml={XML} nodeFrequencies={{}} />)
    const frame = () => container.querySelector('[data-theme-mode="light"]') as HTMLElement
    expect(frame().style.height).toBe("360px")
    rerender(<BpmnHeatmap bpmnXml={XML} nodeFrequencies={{}} height={300} />)
    expect(frame().style.height).toBe("300px")
  })

  it("shows the import failure as an inline error, the parser's words under Details", async () => {
    viewer.fail = true
    render(
      <BpmnHeatmap
        bpmnXml="<broken/>"
        nodeFrequencies={{}}
        errorTitle="Diagram not drawn"
        errorHint="Ask in the chat."
      />,
    )
    const state = await screen.findByRole("alert")
    expect(state.getAttribute("data-variant")).toBe("inline")
    expect(state.textContent).toContain("Diagram not drawn")
    expect(screen.getByText("unparsable <bpmn:x>").closest("details")).toBeTruthy()
  })

  it("says so over the diagram when no element carries a value", async () => {
    render(<BpmnHeatmap bpmnXml={XML} nodeFrequencies={{ Task_A: 0 }} noHeatLabel="No values" />)
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("No values"))
  })
})

describe("HeatmapLegend", () => {
  it("falls back to Less/More without values, the swatch on the light paper", () => {
    const { container } = render(<HeatmapLegend lessLabel="Weniger" moreLabel="Mehr" />)
    expect(screen.getByText("Weniger")).toBeTruthy()
    expect(screen.getByText("Mehr")).toBeTruthy()
    expect(container.querySelector('[data-theme-mode="light"]')).toBeTruthy()
  })

  it("shows one value once, at the swatch's full end where every element paints", () => {
    const { container } = render(<HeatmapLegend min="5" max="5" />)
    const visible = [...container.querySelectorAll("[aria-hidden]")].map((el) => el.textContent)
    expect(visible).toEqual(["", "5"])
    expect(container.querySelector(".sr-only")?.textContent).toBe("5")
  })
})

describe("HeatValuesTable", () => {
  it("renders nothing when no element has a value", () => {
    const { container } = render(
      <HeatValuesTable bpmnXml={XML} values={{ Task_A: 0 }} format={String} />,
    )
    expect(container.innerHTML).toBe("")
  })

  it("takes the caller's words", () => {
    render(
      <HeatValuesTable
        bpmnXml={XML}
        values={{ Unnamed: 5 }}
        format={String}
        labels={{ valuesTable: "Werte", elementColumn: "Schritt", valueColumn: "Anzahl" }}
      />,
    )
    expect(screen.getByRole("columnheader", { name: "Schritt" })).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "Anzahl" })).toBeTruthy()
    expect(screen.getByText("Unnamed").className).toContain("font-mono")
  })
})
