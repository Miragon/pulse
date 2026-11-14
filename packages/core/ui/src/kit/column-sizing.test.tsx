// @vitest-environment happy-dom
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react"
import { LocaleProvider } from "../locale/locale-provider.js"
import { DataTable } from "./data-table.js"
import type { DataTableColumn } from "./data-table-types.js"
import {
  clampWidth,
  COLUMN_WIDTH,
  tableMinWidth,
  validWidths,
  widthsOf,
  type ColumnSizingOptions,
  type ColumnWidths,
} from "./column-sizing.js"
import { useColumnSizing } from "./use-column-sizing.js"

/**
 * Column sizing by mouse and keyboard (the webview's lists): a grip per head, a column menu as
 * the single-pointer way, persistence injected. Layout is mocked: each head reports the width in
 * `WIDTHS`, and a table measured for its content (`max-content`) reports `NATURAL`.
 */

const WIDTHS: Record<string, number> = { name: 120, state: 90, started: 140 }
const NATURAL = 300

function mockLayout() {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const key = this.getAttribute("data-column-key") ?? ""
    const measuring = (this.closest("table") as HTMLElement | null)?.style.width === "max-content"
    const width = measuring ? NATURAL : (WIDTHS[key] ?? 100)
    return { width, height: 28, top: 0, left: 0, right: width, bottom: 28, x: 0, y: 0 } as DOMRect
  })
}

beforeEach(mockLayout)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

interface Row {
  id: string
}

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "name", label: "Name", cell: (row) => row.id },
  { key: "state", label: "State", cell: () => "Running" },
  { key: "icon", label: "", width: 24, cell: () => null },
  { key: "started", label: "Started", cell: () => "10:00" },
]

function Sized(options: ColumnSizingOptions & { columns?: DataTableColumn<Row>[] }) {
  const sizing = useColumnSizing(options)
  return (
    <DataTable
      label="Instances"
      columns={options.columns ?? COLUMNS}
      rows={[{ id: "i-1" }]}
      rowKey={(row) => row.id}
      sizing={sizing}
    />
  )
}

const grip = (name: string) => screen.getByRole("separator", { name: `Resize column ${name}` })
const colWidths = () =>
  Array.from(screen.getByRole("table").querySelectorAll("col")).map((col) => col.style.width)

describe("useColumnSizing: the state, persistence injected", () => {
  it("reads the kept widths once, dropping what is no width", () => {
    const load = vi.fn(() => ({ name: 200, state: 12, started: 99_999, other: Number.NaN }))
    const { result, rerender } = renderHook(() => useColumnSizing({ load }))
    expect(result.current.widths).toEqual({ name: 200 })
    rerender()
    expect(load).toHaveBeenCalledOnce()
  })

  it("starts with no sizing when nothing is kept", () => {
    expect(renderHook(() => useColumnSizing()).result.current.widths).toBeUndefined()
    expect(renderHook(() => useColumnSizing({ load: () => ({}) })).result.current.widths).toBe(
      undefined,
    )
  })

  it("saves only what it is told to persist, and undefined on a reset", () => {
    const save = vi.fn()
    const { result } = renderHook(() => useColumnSizing({ save }))
    act(() => result.current.setWidths({ name: 150 }, false))
    expect(save).not.toHaveBeenCalled()
    act(() => result.current.persist())
    expect(save).toHaveBeenLastCalledWith({ name: 150 })
    act(() => result.current.setWidths(undefined, true))
    expect(save).toHaveBeenLastCalledWith(undefined)
    expect(result.current.widths).toBeUndefined()
  })

  it("persists the widths last set, before that change rendered", () => {
    const save = vi.fn()
    const { result } = renderHook(() => useColumnSizing({ save }))
    const stale = result.current
    act(() => {
      stale.setWidths({ name: 150 }, false)
      stale.setWidths({ name: 180 }, false)
      stale.persist()
    })
    expect(save).toHaveBeenLastCalledWith({ name: 180 })
  })

  it("keeps the widths of the columns that size, all or none", () => {
    expect(widthsOf({ a: 100, b: 50, gone: 300 }, ["a", "b"])).toEqual({ a: 100, b: 50 })
    expect(widthsOf({ a: 100 }, ["a", "b"])).toBeUndefined()
    expect(widthsOf({ a: 100 }, [])).toBeUndefined()
    expect(widthsOf(undefined, ["a"])).toBeUndefined()
  })

  it("clamps a width into the bounds, never under a caption's room", () => {
    expect(clampWidth(10, 0)).toBe(COLUMN_WIDTH.min)
    expect(clampWidth(10, 70)).toBe(70)
    expect(clampWidth(5000, 0)).toBe(COLUMN_WIDTH.max)
    expect(clampWidth(120.4, 0, 100)).toBe(120)
    expect(clampWidth(60, 0, 100)).toBe(100)
    expect(validWidths({ a: 60 }, 64)).toBeUndefined()
    expect(tableMinWidth({ a: 100, b: 50 }, 24)).toBe(254)
  })
})

describe("DataTable sizing: the grip", () => {
  it("puts a grip on each head that sizes: not the last, not a fixed width", () => {
    render(<Sized />)
    expect(screen.getAllByRole("separator").map((el) => el.getAttribute("aria-label"))).toEqual([
      "Resize column Name",
      "Resize column State",
    ])
    const name = grip("Name")
    expect(name.getAttribute("tabindex")).toBe("0")
    expect(name.getAttribute("aria-orientation")).toBe("vertical")
    expect(name.getAttribute("aria-valuemin")).toBe(String(COLUMN_WIDTH.min))
    expect(name.getAttribute("aria-valuemax")).toBe(String(COLUMN_WIDTH.max))
    // A 24 px target centred on the head's edge, its 2 px line in --interaction.
    expect(name.className).toContain("w-6")
    expect(name.className).toContain("-right-3")
    expect(name.className).toContain("after:bg-interaction")
    expect(name.className).toContain("after:w-0.5")
    expect(name.className).toContain("focus-visible:after:opacity-100")
  })

  it("says its width from the start, before it ever had focus (WCAG 4.1.2)", () => {
    render(<Sized />)
    // A focusable separator carries its value, its bounds and its words while untouched.
    for (const separator of screen.getAllByRole("separator")) {
      for (const attribute of ["aria-valuenow", "aria-valuetext", "aria-valuemin", "aria-valuemax"])
        expect(separator.hasAttribute(attribute), attribute).toBe(true)
    }
    expect(grip("Name").getAttribute("aria-valuenow")).toBe("120")
    expect(grip("Name").getAttribute("aria-valuetext")).toBe("120 pixels")
    expect(grip("State").getAttribute("aria-valuenow")).toBe("90")
  })

  it("follows its head's width as the layout changes it, and on focus", () => {
    const observed: Array<{ callback: () => void; disconnect: () => void }> = []
    vi.stubGlobal(
      "ResizeObserver",
      class {
        disconnect = vi.fn()
        constructor(callback: () => void) {
          observed.push({ callback, disconnect: this.disconnect })
        }
        observe() {}
      },
    )
    const { unmount } = render(<Sized />)
    expect(observed).toHaveLength(2)
    WIDTHS.name = 150
    act(() => observed[0].callback())
    expect(grip("Name").getAttribute("aria-valuenow")).toBe("150")
    WIDTHS.name = 160
    fireEvent.focus(grip("Name"))
    expect(grip("Name").getAttribute("aria-valuenow")).toBe("160")
    WIDTHS.name = 120
    unmount()
    expect(observed.every((entry) => vi.mocked(entry.disconnect).mock.calls.length === 1)).toBe(
      true,
    )
    vi.unstubAllGlobals()
  })

  it("draws no outline of its own, so forced colours draw none at rest", () => {
    render(<Sized />)
    expect(grip("Name").className).toContain("outline-none")
    expect(grip("Name").className).not.toContain("outline-hidden")
  })

  it("sizes by 8 px per arrow, 32 with Shift, and the table lays out fixed", () => {
    const save = vi.fn()
    render(<Sized save={save} />)
    expect(screen.getByRole("table").querySelector("colgroup")).toBeNull()
    fireEvent.keyDown(grip("Name"), { key: "ArrowRight" })
    // The first sizing takes every sizing column's width as it shows.
    expect(save).toHaveBeenLastCalledWith({ name: 128, state: 90 })
    const table = screen.getByRole("table")
    expect(table.className).toContain("table-fixed")
    // The fixed column keeps its width, the last one takes the rest.
    expect(colWidths()).toEqual(["128px", "90px", "24px", ""])
    expect(table.style.minWidth).toBe(`${128 + 90 + 24 + 80}px`)
    fireEvent.keyDown(grip("State"), { key: "ArrowLeft", shiftKey: true })
    expect(save).toHaveBeenLastCalledWith({ name: 128, state: 58 })
    expect(grip("Name").getAttribute("aria-valuenow")).toBe("128")
  })

  it("makes a column as narrow as allowed on Home, and fits it to its content on Enter", () => {
    const save = vi.fn()
    render(<Sized save={save} />)
    fireEvent.keyDown(grip("Name"), { key: "Home" })
    expect(save).toHaveBeenLastCalledWith({ name: COLUMN_WIDTH.min, state: 90 })
    fireEvent.keyDown(grip("State"), { key: "Enter" })
    expect(save).toHaveBeenLastCalledWith({ name: COLUMN_WIDTH.min, state: NATURAL })
    fireEvent.doubleClick(grip("Name"))
    expect(save).toHaveBeenLastCalledWith({ name: NATURAL, state: NATURAL })
  })

  it("fits a column to at most half of what its region shows", () => {
    const save = vi.fn()
    render(<Sized save={save} />)
    Object.defineProperty(screen.getByRole("region"), "clientWidth", { value: 400 })
    fireEvent.keyDown(grip("Name"), { key: "Enter" })
    expect(save).toHaveBeenLastCalledWith({ name: 200, state: 90 })
  })

  it("never goes under the minimum it is given", () => {
    const save = vi.fn()
    render(<Sized save={save} min={64} />)
    fireEvent.keyDown(grip("Name"), { key: "Home" })
    expect(save).toHaveBeenLastCalledWith({ name: 64, state: 90 })
    expect(grip("Name").getAttribute("aria-valuemin")).toBe("64")
  })

  it("drags: the width follows the pointer and is saved once, when it is let go", () => {
    const save = vi.fn()
    render(<Sized save={save} />)
    const name = grip("Name")
    fireEvent.pointerDown(name, { button: 0, clientX: 100, pointerId: 1 })
    expect(name.hasAttribute("data-dragging")).toBe(true)
    fireEvent.pointerMove(name, { clientX: 150, pointerId: 1 })
    expect(colWidths()[0]).toBe("170px")
    expect(save).not.toHaveBeenCalled()
    fireEvent.pointerUp(name, { pointerId: 1 })
    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenLastCalledWith({ name: 170, state: 90 })
    expect(name.hasAttribute("data-dragging")).toBe(false)
    // The frame keeps text from being selected while a grip drags.
    expect(screen.getByRole("region").parentElement!.className).toContain(
      "has-[[data-dragging]]:select-none",
    )
  })

  it("cancels a drag on Escape, back to the width it started at", () => {
    const save = vi.fn()
    render(<Sized save={save} />)
    const name = grip("Name")
    fireEvent.pointerDown(name, { button: 0, clientX: 100, pointerId: 1 })
    fireEvent.pointerMove(name, { clientX: 180, pointerId: 1 })
    fireEvent.keyDown(name, { key: "Escape" })
    expect(colWidths()[0]).toBe("120px")
    expect(save).toHaveBeenLastCalledWith({ name: 120, state: 90 })
    fireEvent.pointerMove(name, { clientX: 300, pointerId: 1 })
    expect(colWidths()[0]).toBe("120px")
  })

  it("ignores a secondary button", () => {
    render(<Sized />)
    fireEvent.pointerDown(grip("Name"), { button: 2, clientX: 100 })
    expect(grip("Name").hasAttribute("data-dragging")).toBe(false)
  })

  it("starts from the widths it loads, and lets a NamedId follow the sized column", () => {
    render(<Sized load={() => ({ name: 210, state: 70 })} />)
    expect(colWidths()).toEqual(["210px", "70px", "24px", ""])
    const table = screen.getByRole("table")
    // A NamedId in a sized cell gives way down to nothing, cut where its column ends.
    expect(table.className).toContain("[--named-id-floor:0px]")
    expect(table.className).toContain("[&>tbody>tr>td]:text-ellipsis")
    // A sized table lays out by its widths, not by content.
    expect(table.querySelector("td")!.className).not.toContain("w-[1%]")
  })

  it("leaves out a kept width of a column the table no longer shows", () => {
    const save = vi.fn()
    render(<Sized load={() => ({ name: 210, state: 70, removed: 500 })} save={save} />)
    expect(colWidths()).toEqual(["210px", "70px", "24px", ""])
    // Only what shows counts: no blank room for the column that went.
    expect(screen.getByRole("table").style.minWidth).toBe(`${210 + 70 + 24 + 80}px`)
    // The next sizing starts from the kept widths of what shows (the mocked head says 120).
    fireEvent.keyDown(grip("Name"), { key: "ArrowRight" })
    expect(save).toHaveBeenLastCalledWith({ name: 128, state: 70 })
  })

  it("fits every column to its content again while a column has no kept width", () => {
    const save = vi.fn()
    render(<Sized load={() => ({ name: 210 })} save={save} />)
    expect(screen.getByRole("table").querySelector("colgroup")).toBeNull()
    expect(screen.getByRole("table").className).not.toContain("table-fixed")
    // The next sizing takes every column as it shows.
    fireEvent.keyDown(grip("State"), { key: "ArrowRight" })
    expect(save).toHaveBeenLastCalledWith({ name: 120, state: 98 })
  })
})

describe("DataTable sizing: the column menu (WCAG 2.5.7)", () => {
  const menuButton = (name: string) =>
    screen.getByRole("button", { name: `Width of column ${name}` })

  it("offers a menu button per sizing head, shown on hover or focus and always on touch", () => {
    render(<Sized />)
    const button = menuButton("Name")
    expect(button.getAttribute("aria-haspopup")).toBe("menu")
    expect(button.getAttribute("aria-expanded")).toBe("false")
    expect(button.className).toEqual(expect.stringContaining("[@media(hover:hover)]:opacity-0"))
    expect(button.className).toContain("group-focus-within/th:opacity-100")
    expect(button.className).toContain("group-hover/th:opacity-100")
    expect(button.closest("th")?.className).toContain("group/th")
    expect(screen.queryByRole("button", { name: "Width of column Started" })).toBeNull()
  })

  it("opens on the first entry and moves with the arrows, Home and End", () => {
    render(<Sized />)
    fireEvent.click(menuButton("Name"))
    const menu = screen.getByRole("menu", { name: "Width of column Name" })
    const items = within(menu).getAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "Fit to content",
      "Wider",
      "Narrower",
      "Reset all widths",
    ])
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(menu, { key: "End" })
    expect(document.activeElement).toBe(items[3])
    fireEvent.keyDown(menu, { key: "ArrowDown" })
    expect(document.activeElement).toBe(items[0])
    fireEvent.keyDown(menu, { key: "ArrowUp" })
    expect(document.activeElement).toBe(items[3])
    fireEvent.keyDown(menu, { key: "Home" })
    expect(document.activeElement).toBe(items[0])
  })

  it("sizes by 32 px per entry, fits, and resets every width; focus back on its button", () => {
    const save = vi.fn()
    render(<Sized save={save} />)
    fireEvent.click(menuButton("State"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Wider" }))
    expect(save).toHaveBeenLastCalledWith({ name: 120, state: 122 })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(menuButton("State"))
    fireEvent.click(menuButton("State"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Narrower" }))
    expect(save).toHaveBeenLastCalledWith({ name: 120, state: 58 })
    fireEvent.click(menuButton("Name"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Fit to content" }))
    expect(save).toHaveBeenLastCalledWith({ name: NATURAL, state: 58 })
    fireEvent.click(menuButton("Name"))
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset all widths" }))
    expect(save).toHaveBeenLastCalledWith(undefined)
    expect(screen.getByRole("table").querySelector("colgroup")).toBeNull()
  })

  it("closes on Escape with focus back on the button, and on Tab or a press outside", () => {
    render(<Sized />)
    fireEvent.click(menuButton("Name"))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("menu")).toBeNull()
    expect(document.activeElement).toBe(menuButton("Name"))
    fireEvent.click(menuButton("Name"))
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" })
    expect(screen.queryByRole("menu")).toBeNull()
    fireEvent.click(menuButton("Name"))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole("menu")).toBeNull()
  })

  it("speaks German under a German locale", () => {
    render(
      <LocaleProvider locale="de">
        <Sized
          columns={[
            { key: "name", label: "Name", cell: (row) => row.id },
            { key: "rest", label: "Rest", cell: () => "" },
          ]}
        />
      </LocaleProvider>,
    )
    expect(screen.getByRole("separator", { name: "Breite der Spalte Name ändern" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Breite der Spalte Name" }))
    expect(screen.getByRole("menuitem", { name: "An Inhalt anpassen" })).toBeTruthy()
    fireEvent.focus(screen.getByRole("separator"))
    expect(screen.getByRole("separator").getAttribute("aria-valuetext")).toBe("120 Pixel")
  })
})

describe("DataTable sizing: what never sizes", () => {
  it("draws no grip without sizing, on a bare head or on a table of one column", () => {
    const { rerender } = render(
      <DataTable label="Plain" columns={COLUMNS} rows={[{ id: "i" }]} rowKey={(row) => row.id} />,
    )
    expect(screen.queryAllByRole("separator")).toHaveLength(0)
    function One() {
      const sizing = useColumnSizing()
      const [columns] = useState<DataTableColumn<Row>[]>([{ key: "only", label: "Only" }])
      return (
        <DataTable
          label="One"
          columns={columns}
          rows={[]}
          rowKey={(row) => row.id}
          sizing={sizing}
        />
      )
    }
    rerender(<One />)
    expect(screen.queryAllByRole("separator")).toHaveLength(0)
  })

  it("names a column by its key when its caption is no text", () => {
    function Keyed() {
      const sizing = useColumnSizing()
      const widths: ColumnWidths | undefined = sizing.widths
      return (
        <DataTable
          label={widths ? "sized" : "Keyed"}
          columns={[
            { key: "process", label: <span>Process</span> },
            { key: "named", label: <span>x</span>, name: "Business key" },
            { key: "rest", label: "Rest" },
          ]}
          rows={[]}
          rowKey={(row: Row) => row.id}
          sizing={sizing}
        />
      )
    }
    render(<Keyed />)
    expect(screen.getByRole("separator", { name: "Resize column process" })).toBeTruthy()
    expect(screen.getByRole("separator", { name: "Resize column Business key" })).toBeTruthy()
  })
})
