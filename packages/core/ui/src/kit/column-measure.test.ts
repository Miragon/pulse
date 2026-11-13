// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { COLUMN_KEY_ATTRIBUTE, columnSizer } from "./column-measure.js"
import type { ColumnSizing, ColumnWidths } from "./column-sizing.js"

/** The measures a sizing starts from, on a hand-built head row (layout mocked). */

afterEach(() => vi.restoreAllMocks())

function sizingOf(widths?: ColumnWidths) {
  const setWidths = vi.fn<ColumnSizing["setWidths"]>()
  const sizing: Omit<ColumnSizing, "parts"> = { widths, min: 48, setWidths, persist: vi.fn() }
  return { sizing, setWidths }
}

function widthsBy(of: (element: Element) => number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return { width: of(this) } as DOMRect
  })
}

function headRow(...keys: string[]): HTMLElement[] {
  const row = document.createElement("tr")
  return keys.map((key) => {
    const cell = document.createElement("th")
    cell.setAttribute(COLUMN_KEY_ATTRIBUTE, key)
    row.append(cell)
    return cell
  })
}

describe("columnSizer", () => {
  it("starts from each sizing column's width as it shows, read off the head row", () => {
    widthsBy((element) => (element.getAttribute(COLUMN_KEY_ATTRIBUTE) === "a" ? 150 : 90))
    const [a] = headRow("a", "b")
    const { sizing, setWidths } = sizingOf()
    columnSizer(sizing, ["a", "b"]).resize(a, "a", 160, false)
    expect(setWidths).toHaveBeenCalledWith({ a: 160, b: 90 }, false)
  })

  it("measures a column it cannot find in the row by the cell it sizes", () => {
    widthsBy(() => 70)
    const lone = document.createElement("th")
    const { sizing, setWidths } = sizingOf()
    columnSizer(sizing, ["a", "gone"]).resize(lone, "a", 100, true)
    expect(setWidths).toHaveBeenCalledWith({ a: 100, gone: 70 }, true)
  })

  it("keeps a head's caption and menu whole: never under their width and the padding", () => {
    widthsBy(() => 100)
    const [a] = headRow("a")
    const content = document.createElement("span")
    content.setAttribute("data-slot", "column-head")
    Object.defineProperty(content, "scrollWidth", { value: 90 })
    a.append(content)
    const { sizing, setWidths } = sizingOf({ a: 100 })
    columnSizer(sizing, ["a"]).resize(a, "a", 10, true)
    expect(setWidths).toHaveBeenCalledWith({ a: 114 }, true)
  })

  it("fits a cell outside a table to the width it shows", () => {
    widthsBy(() => 133)
    const { sizing, setWidths } = sizingOf({ a: 60 })
    columnSizer(sizing, ["a"]).fit(document.createElement("th"), "a")
    expect(setWidths).toHaveBeenCalledWith({ a: 133 }, true)
  })

  it("measures a fit with the table laid out by content, then puts its style back", () => {
    const table = document.createElement("table")
    table.setAttribute("style", "min-width: 500px")
    const col = document.createElement("col")
    col.style.width = "60px"
    table.append(col)
    const [a] = headRow("a")
    table.append(a.parentElement!)
    widthsBy((element) =>
      (element.closest("table") as HTMLElement).style.width === "max-content" ? 260 : 60,
    )
    const { sizing, setWidths } = sizingOf({ a: 60 })
    columnSizer(sizing, ["a"]).fit(a, "a")
    expect(setWidths).toHaveBeenCalledWith({ a: 260 }, true)
    expect(table.getAttribute("style")).toBe("min-width: 500px")
    expect(col.style.width).toBe("60px")
  })

  it("resets and saves through the sizing it is given", () => {
    const { sizing, setWidths } = sizingOf({ a: 60 })
    const sizer = columnSizer(sizing, ["a"])
    expect(sizer.widthOf("a")).toBe(60)
    sizer.reset()
    expect(setWidths).toHaveBeenCalledWith(undefined, true)
    sizer.persist()
    expect(sizing.persist).toHaveBeenCalledOnce()
  })
})
