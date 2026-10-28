// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { PipelineContext } from "@miragon/mcp-toolkit-core"
import { GenericDataTableWidget, GenericKpiGridWidget } from "./generic-widgets.js"

/** Labels read for people even when nobody wrote them (#322 U18). */

afterEach(cleanup)

const CONTEXT = {} as PipelineContext

function renderTable(raw: unknown, widgetProps: Record<string, unknown> = {}) {
  render(
    <GenericDataTableWidget
      keys={{ "probe:rows": raw }}
      context={CONTEXT}
      widgetProps={{ dataKey: "probe:rows", ...widgetProps }}
    />,
  )
  return screen.queryAllByRole("columnheader").map((th) => th.textContent)
}

const cells = () => screen.getAllByRole("cell").map((td) => td.textContent)

const ROWS = [
  { process: "Invoice", totalIncidents: 3, process_definition_key: "invoice" },
  { process: "Order", totalIncidents: 0, process_definition_key: "order" },
]

describe("shell:data-table", () => {
  it("derives the columns from the first row, each key in words", () => {
    expect(renderTable(ROWS)).toEqual(["Process", "Total incidents", "Process definition key"])
    const [process, incidents] = screen.getAllByRole("columnheader")
    expect(incidents.className).toContain("text-right")
    expect(process.className).toContain("text-left")
    expect(cells()).toEqual(["Invoice", "3", "invoice", "Order", "0", "order"])
  })

  it("keeps a written label and words the key of a column without one", () => {
    expect(
      renderTable(ROWS, {
        columns: [
          { key: "process", label: "Prozess" },
          { key: "totalIncidents", align: "right" },
          { key: "" },
          { label: "no key" },
          "not a column",
        ],
      }),
    ).toEqual(["Prozess", "Total incidents"])
    expect(screen.getAllByRole("columnheader")[1].className).toContain("text-right")
    expect(cells()).toEqual(["Invoice", "3", "Order", "0"])
  })

  it("derives the columns when none of the given ones is usable", () => {
    expect(renderTable(ROWS, { columns: [{ label: "no key" }] })).toEqual([
      "Process",
      "Total incidents",
      "Process definition key",
    ])
  })

  it("reads { rows: [...] }, derives primitive and null fields only, at most eight", () => {
    const wide = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`field${String(i)}`, i]))
    const row = { flag: true, note: null, nested: { a: 1 }, list: [1], ...wide }
    const headers = renderTable({ rows: [row, "not a record"] })
    expect(headers).toEqual([
      "Flag",
      "Note",
      "Field0",
      "Field1",
      "Field2",
      "Field3",
      "Field4",
      "Field5",
    ])
    // A Boolean in words, null and anything not primitive as a dash.
    expect(cells().slice(0, 3)).toEqual(["Yes", "—", "0"])
  })

  it("shows a dash for a cell whose value is not primitive", () => {
    renderTable([
      { name: "a", detail: "x" },
      { name: "b", detail: { deep: true } },
    ])
    expect(cells()).toEqual(["a", "x", "b", "—"])
  })

  it("says so when the key holds no rows, in the given text or the kit's words", () => {
    renderTable([], { emptyText: "Keine Zeilen." })
    expect(screen.getByText("Keine Zeilen.")).toBeTruthy()
    cleanup()
    renderTable({ rows: "none" })
    expect(screen.getByText("No rows yet")).toBeTruthy()
    cleanup()
    render(<GenericDataTableWidget keys={{}} context={CONTEXT} />)
    expect(screen.getByText("No rows yet")).toBeTruthy()
  })

  it("says so when the first row has no field it can show", () => {
    renderTable([{ nested: { a: 1 } }])
    expect(screen.getByText("No rows yet")).toBeTruthy()
  })
})

function renderKpis(raw: unknown, widgetProps: Record<string, unknown> = {}) {
  return render(
    <GenericKpiGridWidget
      keys={{ "probe:kpis": raw }}
      context={CONTEXT}
      widgetProps={{ dataKey: "probe:kpis", ...widgetProps }}
    />,
  )
}

describe("shell:kpi-grid", () => {
  it("renders an array of cells, skipping the ones without a label", () => {
    const { container } = renderKpis([
      { label: "Open incidents", value: 4, tone: "danger", fraction: " /10" },
      { label: "Running", value: "12" },
      { label: "Healthy", value: true, tone: "critical" },
      { label: "Unknown", value: { n: 1 }, tone: 7 },
      { label: "", value: 1 },
      { value: 2 },
      "not a cell",
    ])
    const text = container.textContent ?? ""
    for (const shown of ["Open incidents", "4", "/10", "Running", "12", "Healthy", "Yes"]) {
      expect(text).toContain(shown)
    }
    expect(text).toContain("Unknown")
    expect(text).toContain("—")
    expect(container.querySelectorAll("[data-tone]").length).toBeGreaterThan(0)
  })

  it("renders a plain { label: value } object, primitive values only", () => {
    const { container } = renderKpis({ "Open incidents": 4, Running: "12", nested: { a: 1 } })
    const text = container.textContent ?? ""
    expect(text).toContain("Open incidents")
    expect(text).toContain("Running")
    expect(text).not.toContain("nested")
  })

  it("passes the frame and the style on", () => {
    const strip = renderKpis([{ label: "Running", value: 1 }]).container.innerHTML
    cleanup()
    const soft = renderKpis([{ label: "Running", value: 1 }], {
      boxed: true,
      variant: "soft",
    }).container.innerHTML
    expect(soft).not.toBe(strip)
  })

  it("says so when the key holds no cells, in the given text or the kit's words", () => {
    renderKpis("not cells", { emptyText: "Keine Kennzahlen." })
    expect(screen.getByText("Keine Kennzahlen.")).toBeTruthy()
    cleanup()
    renderKpis([])
    expect(screen.getByText("No figures yet")).toBeTruthy()
    cleanup()
    render(<GenericKpiGridWidget keys={{}} context={CONTEXT} widgetProps={{ dataKey: 7 }} />)
    expect(screen.getByText("No figures yet")).toBeTruthy()
  })
})
