// @vitest-environment happy-dom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DataTable } from "./data-table.js"
import type { DataTableColumn } from "./data-table-types.js"
import { Td } from "./table.js"
import { useColumnSizing } from "./use-column-sizing.js"

/** Rows composed by hand fit a column marked `fit` to its content, as drawn rows fit theirs. */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

const COLUMNS: DataTableColumn[] = [
  { key: "source", label: "Source", fit: true },
  { key: "note", label: "Note" },
  { key: "waiting", label: "Waiting", fit: true },
]

function Line({ id }: { id: string }) {
  return (
    <tr>
      <Td>{`Approve ${id}`}</Td>
      <Td>A note that may wrap where the region is short of room</Td>
      <Td>3 selected wait here</Td>
    </tr>
  )
}

/** Per body row, whether each of its cells is marked as one of a fitting column. */
const marks = (table: HTMLElement) =>
  Array.from(table.querySelectorAll("tbody tr")).map((row) =>
    Array.from(row.children).map((cell) => cell.hasAttribute("data-fit")),
  )

describe("DataTable: a column of composed rows that fits its content", () => {
  it("fits its head as a drawn table's, and marks its cells by their position", () => {
    render(
      <DataTable label="Mapping" columns={COLUMNS}>
        <Line id="a" />
        <Line id="b" />
      </DataTable>,
    )
    const table = screen.getByRole("table", { name: "Mapping" })
    const heads = screen.getAllByRole("columnheader")
    expect(heads.map((head) => classes(head).includes("w-[1%]"))).toEqual([true, false, true])
    expect(classes(heads[0])).toContain("[--named-id-floor:max-content]")
    expect(marks(table)).toEqual([
      [true, false, true],
      [true, false, true],
    ])
    // A marked cell keeps one line and a NamedId in it whole; the others lay out by content.
    expect(classes(table.querySelector("tbody"))).toEqual(
      expect.arrayContaining([
        "[&>tr>[data-fit]]:whitespace-nowrap",
        "[&>tr>[data-fit]]:[--named-id-floor:max-content]",
        "[&>tr:hover]:bg-accent",
      ]),
    )
    for (const cell of table.querySelectorAll("td")) {
      expect(classes(cell)).not.toContain("w-[1%]")
    }
  })

  it("counts a cell's span, and never marks a cell that spans columns", () => {
    render(
      <DataTable label="Mapping" columns={COLUMNS}>
        <tr>
          <Td colSpan={2}>Nothing maps here yet</Td>
          <Td>0</Td>
        </tr>
      </DataTable>,
    )
    expect(marks(screen.getByRole("table"))).toEqual([[false, true]])
  })

  it("marks the rows that come later and the cells a row adds", async () => {
    function Growing() {
      const [ids, setIds] = useState(["a"])
      return (
        <>
          <button type="button" onClick={() => setIds((was) => [...was, `${was.length}`])}>
            more
          </button>
          <DataTable label="Mapping" columns={COLUMNS}>
            {ids.map((id) => (
              <Line key={id} id={id} />
            ))}
          </DataTable>
        </>
      )
    }
    render(<Growing />)
    fireEvent.click(screen.getByRole("button", { name: "more" }))
    await vi.waitFor(() =>
      expect(marks(screen.getByRole("table"))).toEqual([
        [true, false, true],
        [true, false, true],
      ]),
    )
  })

  it("leaves a table without one unmarked, its rows laid out by their content", () => {
    render(
      <DataTable label="Mapping" columns={COLUMNS.map((column) => ({ ...column, fit: false }))}>
        <Line id="a" />
      </DataTable>,
    )
    expect(marks(screen.getByRole("table"))).toEqual([[false, false, false]])
    for (const head of screen.getAllByRole("columnheader")) {
      expect(classes(head)).not.toContain("w-[1%]")
    }
  })

  it("drops the fit once the columns are sized, the widths laying the table out", () => {
    function Sizable({ sized }: { sized: boolean }) {
      const sizing = useColumnSizing({ load: () => ({ source: 140, note: 220 }) })
      return (
        <DataTable label="Mapping" columns={COLUMNS} sizing={sized ? sizing : undefined}>
          <Line id="a" />
        </DataTable>
      )
    }
    const { rerender } = render(<Sizable sized={false} />)
    expect(marks(screen.getByRole("table"))).toEqual([[true, false, true]])
    rerender(<Sizable sized />)
    expect(marks(screen.getByRole("table"))).toEqual([[false, false, false]])
    for (const head of screen.getAllByRole("columnheader")) {
      expect(classes(head)).not.toContain("w-[1%]")
    }
  })

  it("ignores fit in a drawn table, which fits every column but the one taking the rest", () => {
    render(
      <DataTable
        label="Orders"
        columns={[
          { key: "name", label: "Name", cell: (row: { id: string }) => row.id },
          { key: "total", label: "Total", fit: true, cell: () => 1 },
        ]}
        rows={[{ id: "o-1" }]}
        rowKey={(row) => row.id}
      />,
    )
    const heads = screen.getAllByRole("columnheader")
    expect(heads.map((head) => classes(head).includes("w-[1%]"))).toEqual([true, false])
    expect(screen.getByRole("table").querySelector("[data-fit]")).toBeNull()
  })
})
