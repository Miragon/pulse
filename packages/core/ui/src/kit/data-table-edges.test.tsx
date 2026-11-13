// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DataTable } from "./data-table.js"
import type { DataTableColumn } from "./data-table-types.js"
import { useColumnSizing, type ColumnSizingOptions } from "./column-sizing.js"
import { NamedId } from "./named-id.js"

/** The edges of DataTable, its grip and its menu: placement, dismissal, the quiet branches. */

interface Row {
  id: string
}

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "name", label: "Name", cell: (row) => row.id },
  { key: "count", label: "Count", align: "right", sort: "descending", cell: () => 3 },
  { key: "rest", label: "Rest", cell: () => "" },
]

function Sized(options: ColumnSizingOptions) {
  const sizing = useColumnSizing(options)
  return (
    <DataTable
      label="Edges"
      columns={COLUMNS}
      rows={[{ id: "r-1" }]}
      rowKey={(row) => row.id}
      sizing={sizing}
      selection={{
        isSelected: () => false,
        onToggle: () => undefined,
        all: false,
        onToggleAll: () => undefined,
        rowLabel: (row) => `Choose ${row.id}`,
      }}
    />
  )
}

let buttonRect = { top: 10, bottom: 34, left: 40 }

beforeEach(() => {
  buttonRect = { top: 10, bottom: 34, left: 40 }
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const { top, bottom, left } = buttonRect
    const width = this.tagName === "BUTTON" ? 24 : 100
    return { width, height: 24, top, bottom, left, right: left + width, x: left, y: top } as DOMRect
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Sets a layout getter of every element for one test; the original goes back after it. */
function mockElementSize(name: "offsetHeight" | "offsetWidth", value: number) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name)
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get: () => value })
  restores.push(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, name, original)
    else delete (HTMLElement.prototype as Partial<Record<typeof name, number>>)[name]
  })
}
const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
})

const menuButton = (name: string) => screen.getByRole("button", { name: `Width of column ${name}` })
const menuPanel = () => screen.getByRole("menu")

describe("DataTable sizing: heads that size", () => {
  it("keeps a right-aligned head's caption, sort arrow and menu on the cell's own side", () => {
    render(<Sized />)
    const head = screen.getByRole("columnheader", { name: /Count/ })
    expect(head.getAttribute("aria-sort")).toBe("descending")
    const content = head.querySelector("[data-slot='column-head']")!
    expect(content.className).toContain("flex-row-reverse")
    expect(head.querySelector("svg.lucide-arrow-down")).toBeTruthy()
  })

  it("counts the selection column in a sized table's minimum width and widths", () => {
    const save = vi.fn()
    render(<Sized save={save} />)
    fireEvent.keyDown(screen.getByRole("separator", { name: "Resize column Name" }), {
      key: "ArrowRight",
    })
    const cols = Array.from(screen.getByRole("table").querySelectorAll("col"))
    expect(cols.map((col) => col.style.width)).toEqual(["32px", "108px", "100px", ""])
    expect(screen.getByRole("table").style.minWidth).toBe(`${108 + 100 + 80 + 32}px`)
  })
})

describe("DataTable sizing: the grip's quiet branches", () => {
  it("ignores keys it has no use for, Escape without a drag, and a release without one", () => {
    const save = vi.fn()
    render(<Sized save={save} />)
    const grip = screen.getByRole("separator", { name: "Resize column Name" })
    fireEvent.keyDown(grip, { key: "a" })
    fireEvent.keyDown(grip, { key: "Escape" })
    fireEvent.pointerUp(grip)
    fireEvent.lostPointerCapture(grip)
    expect(save).not.toHaveBeenCalled()
  })

  it("ends a drag when it loses the pointer, saving once", () => {
    const save = vi.fn()
    render(<Sized save={save} />)
    const grip = screen.getByRole("separator", { name: "Resize column Name" })
    fireEvent.pointerDown(grip, { button: 0, clientX: 0, pointerId: 3 })
    fireEvent.pointerMove(grip, { clientX: 20, pointerId: 3 })
    fireEvent.lostPointerCapture(grip, { pointerId: 3 })
    expect(save).toHaveBeenCalledOnce()
    expect(grip.hasAttribute("data-dragging")).toBe(false)
    fireEvent.pointerUp(grip, { pointerId: 3 })
    expect(save).toHaveBeenCalledOnce()
  })
})

describe("DataTable sizing: the menu's placement and dismissal", () => {
  it("opens below its button, or over it where the frame has no room below", () => {
    render(<Sized />)
    fireEvent.click(menuButton("Name"))
    expect(menuPanel().style.top).toBe("38px")
    expect(menuPanel().style.left).toBe("40px")
    fireEvent.click(menuButton("Name"))
    expect(screen.queryByRole("menu")).toBeNull()
    buttonRect = { top: window.innerHeight - 30, bottom: window.innerHeight - 6, left: 40 }
    mockElementSize("offsetHeight", 160)
    fireEvent.click(menuButton("Name"))
    expect(menuPanel().style.top).toBe(`${window.innerHeight - 30 - 4 - 160}px`)
  })

  it("never opens off the side of the frame", () => {
    buttonRect = { top: 10, bottom: 34, left: window.innerWidth - 10 }
    mockElementSize("offsetWidth", 180)
    render(<Sized />)
    fireEvent.click(menuButton("Name"))
    expect(menuPanel().style.left).toBe(`${window.innerWidth - 180 - 4}px`)
  })

  it("stays open for a press inside, closes on a scroll or a resize", () => {
    render(<Sized />)
    fireEvent.click(menuButton("Name"))
    fireEvent.pointerDown(menuPanel())
    expect(screen.getByRole("menu")).toBeTruthy()
    fireEvent.scroll(window)
    expect(screen.queryByRole("menu")).toBeNull()
    fireEvent.click(menuButton("Name"))
    fireEvent(window, new Event("resize"))
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("leaves other keys to the menu's entries", () => {
    render(<Sized />)
    fireEvent.click(menuButton("Name"))
    const first = screen.getAllByRole("menuitem")[0]
    fireEvent.keyDown(menuPanel(), { key: "x" })
    fireEvent.keyDown(document, { key: "x" })
    expect(document.activeElement).toBe(first)
    expect(screen.getByRole("menu")).toBeTruthy()
  })
})

describe("DataTable: loading with a selection column", () => {
  it("draws a bar for the selection column too", () => {
    render(
      <DataTable
        label="Loading"
        columns={COLUMNS}
        rows={[]}
        rowKey={(row: Row) => row.id}
        skeletonRows={2}
        selection={{
          isSelected: () => false,
          onToggle: () => undefined,
          all: false,
          onToggleAll: () => undefined,
          rowLabel: (row) => row.id,
        }}
      />,
    )
    const row = screen.getByRole("region").querySelector("tbody tr")!
    expect(row.querySelectorAll("td")).toHaveLength(COLUMNS.length + 1)
  })
})

describe("NamedId inline: the title", () => {
  it("takes the words of the details, not their elements", () => {
    const { container } = render(
      <NamedId name="Order" id="order" detail={[3, <em key="e">v3</em>, "Task"]} layout="inline" />,
    )
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe(
      "Order · order · 3 · Task",
    )
    expect(container.textContent).toBe("Order order · 3 · v3 · Task")
  })
})

describe("DataTable sizing: a cut cell offers its whole text", () => {
  it("titles a cell its sized column cuts, and drops the title once it fits again", () => {
    render(<Sized load={() => ({ name: 60, count: 60 })} />)
    const cell = screen.getByRole("cell", { name: "r-1" })
    let scrollWidth = 140
    Object.defineProperty(cell, "scrollWidth", { configurable: true, get: () => scrollWidth })
    Object.defineProperty(cell, "clientWidth", { configurable: true, get: () => 60 })
    fireEvent.pointerOver(cell)
    expect(cell.getAttribute("title")).toBe("r-1")
    scrollWidth = 60
    fireEvent.pointerOver(cell)
    expect(cell.hasAttribute("title")).toBe(false)
  })

  it("keeps a title the cell names itself", () => {
    function Titled() {
      const sizing = useColumnSizing({ load: () => ({ a: 60 }) })
      return (
        <DataTable
          label="Titled"
          columns={[
            { key: "a", label: "A" },
            { key: "b", label: "B" },
          ]}
          sizing={sizing}
        >
          <tr>
            <td title="the cell's own">a</td>
            <td>b</td>
          </tr>
        </DataTable>
      )
    }
    render(<Titled />)
    const cell = screen.getByRole("cell", { name: "a" })
    Object.defineProperty(cell, "scrollWidth", { configurable: true, get: () => 10 })
    fireEvent.pointerOver(cell)
    expect(cell.getAttribute("title")).toBe("the cell's own")
    // Nowhere near a cell: nothing to offer.
    fireEvent.pointerOver(screen.getByRole("table"))
  })

  it("offers nothing while the columns fit their content", () => {
    render(<Sized />)
    const cell = screen.getByRole("cell", { name: "r-1" })
    Object.defineProperty(cell, "scrollWidth", { configurable: true, get: () => 500 })
    fireEvent.pointerOver(cell)
    expect(cell.hasAttribute("title")).toBe(false)
  })
})
