// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { DataTable } from "./data-table.js"
import type { DataTableColumn } from "./data-table-types.js"

afterEach(cleanup)

interface Order {
  id: string
  name: string
}

const ORDERS: Order[] = [
  { id: "o-1", name: "Bike" },
  { id: "o-2", name: "Helmet" },
]

const COLUMNS: DataTableColumn<Order>[] = [{ key: "name", label: "Name", cell: (row) => row.name }]

function Orders({
  onCopy = vi.fn(),
  copyHint,
}: {
  onCopy?: (row: Order) => void
  copyHint?: string
}) {
  return (
    <DataTable
      label="Orders"
      columns={COLUMNS}
      rows={ORDERS}
      rowKey={(row) => row.id}
      onActivate={() => undefined}
      onCopy={onCopy}
      copyHint={copyHint}
    />
  )
}

const bodyRows = () =>
  Array.from(screen.getByRole("table").querySelectorAll<HTMLElement>("tbody tr"))

/**
 * What Ctrl or Cmd with C does on a drawn row: the row's own copy, unless the reader selected text
 * in it, and what a screen reader hears it copies.
 */
describe("DataTable: a drawn row's copy", () => {
  it("leaves Ctrl or Cmd with C to the browser where the reader selected text in the row", () => {
    const onCopy = vi.fn()
    render(<Orders onCopy={onCopy} />)
    const [first, second] = bodyRows()
    const selection = window.getSelection()
    selection?.selectAllChildren(within(first).getByText("Bike"))
    // The browser's own copy of the selection goes on: nothing prevents it.
    expect(fireEvent.keyDown(first, { key: "c", ctrlKey: true })).toBe(true)
    expect(onCopy).not.toHaveBeenCalled()
    // A selection in another row leaves this row's copy alone.
    expect(fireEvent.keyDown(second, { key: "c", metaKey: true })).toBe(false)
    expect(onCopy.mock.calls).toEqual([[ORDERS[1]]])
    selection?.removeAllRanges()
  })

  it("says that a row copies its ID, or what the table's copyHint names", () => {
    render(<Orders />)
    const hintOf = (row: HTMLElement) =>
      document.getElementById(row.getAttribute("aria-describedby") ?? "")?.textContent
    expect(hintOf(bodyRows()[0])).toBe("Enter opens the row, Ctrl or Cmd+C copies its ID.")
    cleanup()
    render(<Orders copyHint="Enter opens the row, Ctrl or Cmd+C copies its message." />)
    expect(hintOf(bodyRows()[0])).toBe("Enter opens the row, Ctrl or Cmd+C copies its message.")
  })
})
