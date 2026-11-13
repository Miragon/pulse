// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { LocaleProvider } from "../locale/locale-provider.js"
import { DataTable } from "./data-table.js"
import type { DataTableColumn, DataTableSelection } from "./data-table-types.js"

/** DataTable's selection column: a box per row, one in the head for every row shown (mixed). */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

interface Order {
  id: string
  name: string
  total: number
}

const ORDERS: Order[] = [
  { id: "o-1", name: "Bike", total: 3 },
  { id: "o-2", name: "Helmet", total: 1 },
  { id: "o-3", name: "Lock", total: 2 },
]

const COLUMNS: DataTableColumn<Order>[] = [
  { key: "name", label: "Name", cell: (row) => row.name },
  { key: "total", label: "Total", align: "right", cell: (row) => row.total },
]

describe("DataTable: the selection column", () => {
  function Selectable({
    all = false,
    selected = new Set<string>(),
    onToggle = vi.fn(),
    onToggleAll = vi.fn(),
    onActivate,
  }: {
    all?: boolean | "indeterminate"
    selected?: Set<string>
    onToggle?: (row: Order) => void
    onToggleAll?: () => void
    onActivate?: () => void
  }) {
    const selection: DataTableSelection<Order> = {
      isSelected: (row) => selected.has(row.id),
      isSelectable: (row) => row.id !== "o-3",
      onToggle,
      all,
      onToggleAll,
      rowLabel: (row) => `Select ${row.name}`,
    }
    return (
      <DataTable
        label="Orders"
        columns={COLUMNS}
        rows={ORDERS}
        rowKey={(row) => row.id}
        selection={selection}
        onActivate={onActivate}
      />
    )
  }

  it("puts a 32 px box column first, the head's box named by the kit", () => {
    render(<Selectable />)
    const heads = screen.getAllByRole("columnheader")
    expect(heads).toHaveLength(3)
    expect(heads[0]?.getAttribute("style")).toContain("width: 32px")
    expect(classes(heads[0] ?? null)).toContain("w-8")
    expect(screen.getByRole("checkbox", { name: "Select all shown rows" })).toBeTruthy()
  })

  it("reads mixed in the head while some rows are chosen", () => {
    render(<Selectable all="indeterminate" selected={new Set(["o-1"])} />)
    const head = screen.getByRole("checkbox", { name: "Select all shown rows" })
    expect(head.getAttribute("aria-checked")).toBe("mixed")
    expect(screen.getByRole("checkbox", { name: "Select Bike" }).getAttribute("aria-checked")).toBe(
      "true",
    )
    // A chosen row is marked for its fill.
    const row = screen.getByRole("checkbox", { name: "Select Bike" }).closest("tr")!
    expect(row.hasAttribute("data-selected")).toBe(true)
  })

  it("names each row's box, and a row that cannot be chosen shows none", () => {
    render(<Selectable />)
    expect(screen.getByRole("checkbox", { name: "Select Helmet" })).toBeTruthy()
    expect(screen.queryByRole("checkbox", { name: "Select Lock" })).toBeNull()
  })

  it("toggles a row by its box and every row by the head's", () => {
    const onToggle = vi.fn()
    const onToggleAll = vi.fn()
    render(<Selectable onToggle={onToggle} onToggleAll={onToggleAll} />)
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Helmet" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all shown rows" }))
    expect(onToggle).toHaveBeenCalledWith(ORDERS[1])
    expect(onToggleAll).toHaveBeenCalledOnce()
  })

  it("in rows that take focus, Space toggles and the box is no tab stop of its own", () => {
    const onToggle = vi.fn()
    const onActivate = vi.fn()
    render(<Selectable onToggle={onToggle} onActivate={onActivate} />)
    const box = screen.getByRole("checkbox", { name: "Select Bike" })
    expect(box.getAttribute("tabindex")).toBe("-1")
    const row = box.closest("tr")!
    fireEvent.keyDown(row, { key: " " })
    expect(onToggle).toHaveBeenCalledWith(ORDERS[0])
    // Clicking the box toggles it without opening the row.
    fireEvent.click(box)
    expect(onActivate).not.toHaveBeenCalled()
    // A row that cannot be chosen ignores Space.
    const lock = screen.getByText("Lock").closest("tr")!
    fireEvent.keyDown(lock, { key: " " })
    expect(onToggle).toHaveBeenCalledTimes(2)
  })

  it("names the head's box in German under a German locale", () => {
    render(
      <LocaleProvider locale="de">
        <Selectable />
      </LocaleProvider>,
    )
    expect(screen.getByRole("checkbox", { name: "Alle gezeigten Zeilen auswählen" })).toBeTruthy()
  })
})
