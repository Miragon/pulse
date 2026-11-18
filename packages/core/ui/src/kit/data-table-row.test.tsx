// @vitest-environment happy-dom
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { DataTable } from "./data-table.js"
import { DataTableRow } from "./data-table-target.js"
import type { RowActivation } from "./data-table-types.js"
import { Td } from "./table.js"
import { LocaleProvider } from "../locale/locale-provider.js"

afterEach(cleanup)

interface Order {
  id: string
  name: string
  /** Opens nothing (an engine no view reads). */
  closed?: boolean
}

const ORDERS: Order[] = [
  { id: "o-1", name: "Bike" },
  { id: "o-2", name: "Helmet", closed: true },
  { id: "o-3", name: "Lock" },
  { id: "o-4", name: "Bell" },
]

function Orders({
  orders = ORDERS,
  onOpen = vi.fn(),
  onCopy,
  copyHint,
}: {
  orders?: Order[]
  onOpen?: (order: Order, how: RowActivation) => void
  onCopy?: (order: Order) => void
  copyHint?: string
}) {
  return (
    <DataTable
      label="Orders"
      columns={[{ key: "name", label: "Name" }, { key: "act" }]}
      copyHint={copyHint}
    >
      {orders.map((order) => (
        <DataTableRow
          key={order.id}
          label={`Order ${order.id}`}
          onActivate={order.closed ? undefined : (how) => onOpen(order, how)}
          onCopy={onCopy && (() => onCopy(order))}
        >
          <Td>{order.name}</Td>
          <Td>
            <button type="button">Retry {order.id}</button>
            <details>
              <summary>Why {order.id}</summary>
              <p>Card declined</p>
            </details>
          </Td>
        </DataTableRow>
      ))}
    </DataTable>
  )
}

const bodyRows = () =>
  Array.from(screen.getByRole("table").querySelectorAll<HTMLElement>("tbody > tr"))

describe("DataTableRow: a composed row as a target", () => {
  it("names each target row and tells a screen reader that Enter opens it", () => {
    render(<Orders />)
    const [first, closed] = bodyRows()
    expect(screen.getByRole("row", { name: "Order o-1" })).toBe(first)
    const hint = document.getElementById(first.getAttribute("aria-describedby") ?? "")
    expect(hint?.textContent).toBe("Enter opens the row.")
    expect(hint?.hidden).toBe(true)
    // A row that opens nothing is a plain row, named by its cells, with no hint.
    expect(closed.hasAttribute("aria-label")).toBe(false)
    expect(closed.hasAttribute("aria-describedby")).toBe(false)
    expect(closed.className).not.toContain("cursor-pointer")
  })

  it("says that Ctrl or Cmd with C copies, where the row copies, in the kit's locale", () => {
    render(
      <LocaleProvider locale="de">
        <Orders onCopy={vi.fn()} />
      </LocaleProvider>,
    )
    const hint = document.getElementById(bodyRows()[0].getAttribute("aria-describedby") ?? "")
    expect(hint?.textContent).toBe("Enter öffnet die Zeile, Strg oder Cmd+C kopiert ihre ID.")
  })

  it("says what the rows copy where they copy no id (the table's copyHint)", () => {
    render(
      <Orders onCopy={vi.fn()} copyHint="Enter opens the row, Ctrl or Cmd+C copies its message." />,
    )
    const hint = document.getElementById(bodyRows()[0].getAttribute("aria-describedby") ?? "")
    expect(hint?.textContent).toBe("Enter opens the row, Ctrl or Cmd+C copies its message.")
  })

  it("draws the focus inside the row and gives the target rows one tab stop, the region none", () => {
    render(<Orders />)
    const [first, closed, third] = bodyRows()
    expect(first.getAttribute("tabindex")).toBe("0")
    expect(third.getAttribute("tabindex")).toBe("-1")
    expect(closed.hasAttribute("tabindex")).toBe(false)
    expect(first.className).toContain("focus-visible:outline-(length:--focus-width)")
    expect(first.className).toContain("cursor-pointer")
    expect(screen.getByRole("region").hasAttribute("tabindex")).toBe(false)
  })

  it("moves with the arrows, Home and End past rows that open nothing; the tab stop follows", () => {
    render(<Orders />)
    const [first, , third, fourth] = bodyRows()
    first.focus()
    fireEvent.keyDown(first, { key: "ArrowDown" })
    expect(document.activeElement).toBe(third)
    expect(third.getAttribute("tabindex")).toBe("0")
    expect(first.getAttribute("tabindex")).toBe("-1")
    fireEvent.keyDown(third, { key: "End" })
    expect(document.activeElement).toBe(fourth)
    fireEvent.keyDown(fourth, { key: "ArrowDown" })
    expect(document.activeElement).toBe(fourth)
    fireEvent.keyDown(fourth, { key: "ArrowUp" })
    expect(document.activeElement).toBe(third)
    fireEvent.keyDown(third, { key: "Home" })
    expect(document.activeElement).toBe(first)
    // Other keys stay the page's.
    const tab = fireEvent.keyDown(first, { key: "Tab" })
    expect(tab).toBe(true)
  })

  it("opens a row on Enter or a click, beside the view with Ctrl or Cmd", () => {
    const onOpen = vi.fn()
    render(<Orders onOpen={onOpen} />)
    const [first, closed, third] = bodyRows()
    fireEvent.keyDown(first, { key: "Enter" })
    fireEvent.keyDown(first, { key: "Enter", metaKey: true })
    fireEvent.click(within(third).getByText("Lock"))
    fireEvent.click(within(third).getByText("Lock"), { ctrlKey: true })
    fireEvent.click(within(closed).getByText("Helmet"))
    fireEvent.keyDown(closed, { key: "Enter" })
    expect(onOpen.mock.calls).toEqual([
      [ORDERS[0], { toSide: false }],
      [ORDERS[0], { toSide: true }],
      [ORDERS[2], { toSide: false }],
      [ORDERS[2], { toSide: true }],
    ])
  })

  it("leaves a control and a disclosure in the row to themselves", () => {
    const onOpen = vi.fn()
    render(<Orders onOpen={onOpen} />)
    const retry = screen.getByRole("button", { name: "Retry o-1" })
    fireEvent.click(retry)
    fireEvent.keyDown(retry, { key: "Enter" })
    fireEvent.keyDown(retry, { key: "ArrowDown" })
    fireEvent.click(screen.getByText("Why o-1"))
    fireEvent.click(screen.getAllByText("Card declined")[0])
    expect(onOpen).not.toHaveBeenCalled()
    expect(document.activeElement).not.toBe(bodyRows()[2])
  })

  it("selects instead of opening where a click ends a text selection in the row", () => {
    const onOpen = vi.fn()
    render(<Orders onOpen={onOpen} />)
    const cell = within(bodyRows()[0]).getByText("Bike")
    const selection = window.getSelection()
    selection?.selectAllChildren(cell)
    fireEvent.click(cell)
    expect(onOpen).not.toHaveBeenCalled()
    // A selection elsewhere leaves the row's click alone.
    selection?.selectAllChildren(within(bodyRows()[3]).getByText("Bell"))
    fireEvent.click(cell)
    expect(onOpen).toHaveBeenCalledTimes(1)
    selection?.removeAllRanges()
  })

  it("copies what a focused row names on Ctrl or Cmd with C, and nothing without a copy", () => {
    const onCopy = vi.fn()
    render(<Orders onCopy={onCopy} />)
    const [first] = bodyRows()
    fireEvent.keyDown(first, { key: "c", ctrlKey: true })
    fireEvent.keyDown(first, { key: "C", metaKey: true })
    fireEvent.keyDown(first, { key: "c" })
    expect(onCopy.mock.calls).toEqual([[ORDERS[0]], [ORDERS[0]]])
    cleanup()
    render(<Orders />)
    const copy = fireEvent.keyDown(bodyRows()[0], { key: "c", ctrlKey: true })
    // The browser's own copy goes on.
    expect(copy).toBe(true)
  })

  it("leaves Ctrl or Cmd with C to the browser where the reader selected text in the row", () => {
    const onCopy = vi.fn()
    render(<Orders onCopy={onCopy} />)
    const [first, , third] = bodyRows()
    const selection = window.getSelection()
    // A selection that ends in the row (dragged from a cell of the row before) counts too.
    selection?.setBaseAndExtent(
      within(bodyRows()[1]).getByText("Helmet"),
      0,
      within(first).getByText("Bike"),
      1,
    )
    expect(fireEvent.keyDown(first, { key: "c", ctrlKey: true })).toBe(true)
    selection?.selectAllChildren(screen.getAllByText("Card declined")[0])
    expect(fireEvent.keyDown(first, { key: "C", metaKey: true })).toBe(true)
    expect(onCopy).not.toHaveBeenCalled()
    // The row without a selection in it copies what it names, the browser's copy held back.
    expect(fireEvent.keyDown(third, { key: "c", ctrlKey: true })).toBe(false)
    expect(onCopy.mock.calls).toEqual([[ORDERS[2]]])
    selection?.removeAllRanges()
  })

  it("keeps the tab stop on the row focused last, else on the first, as rows come and go", async () => {
    function Live() {
      const [orders, setOrders] = useState(ORDERS)
      return (
        <>
          <button type="button" onClick={() => setOrders(ORDERS.slice(2))}>
            drop
          </button>
          <button type="button" onClick={() => setOrders([...ORDERS, { id: "o-5", name: "Bag" }])}>
            add
          </button>
          <Orders orders={orders} />
        </>
      )
    }
    render(<Live />)
    bodyRows()[3].focus()
    fireEvent.click(screen.getByRole("button", { name: "add" }))
    await Promise.resolve()
    expect(bodyRows()[3].getAttribute("tabindex")).toBe("0")
    expect(bodyRows()[4].getAttribute("tabindex")).toBe("-1")
    fireEvent.click(screen.getByRole("button", { name: "drop" }))
    await Promise.resolve()
    // The row focused last is still there: it keeps the tab stop.
    expect(bodyRows()[1].getAttribute("tabindex")).toBe("0")
    expect(bodyRows()[0].getAttribute("tabindex")).toBe("-1")
  })

  it("gives the tab stop back to the first target once the active row stops opening", async () => {
    function Closing() {
      const [orders, setOrders] = useState(ORDERS)
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setOrders(ORDERS.map((order) => ({ ...order, closed: order.id !== "o-4" })))
            }
          >
            close
          </button>
          <Orders orders={orders} />
        </>
      )
    }
    render(<Closing />)
    bodyRows()[0].focus()
    fireEvent.click(screen.getByRole("button", { name: "close" }))
    await Promise.resolve()
    const rows = bodyRows()
    expect(rows[0].hasAttribute("tabindex")).toBe(false)
    expect(rows[3].getAttribute("tabindex")).toBe("0")
    // A body without a target row gives the region its tab stop again.
    cleanup()
    render(<Orders orders={ORDERS.map((order) => ({ ...order, closed: true }))} />)
    expect(screen.getByRole("region").getAttribute("tabindex")).toBe("0")
    expect(document.querySelectorAll("[hidden]")).toHaveLength(0)
  })

  it("stands alone outside a table as a tab stop of its own, with no hint", () => {
    const onOpen = vi.fn()
    render(
      <table>
        <tbody>
          <DataTableRow label="Order o-1" onActivate={onOpen}>
            <td>Bike</td>
          </DataTableRow>
        </tbody>
      </table>,
    )
    const row = screen.getByRole("row", { name: "Order o-1" })
    expect(row.getAttribute("tabindex")).toBe("0")
    expect(row.hasAttribute("aria-describedby")).toBe(false)
    fireEvent.keyDown(row, { key: "Enter" })
    fireEvent.keyDown(within(row).getByText("Bike"), { key: "Enter" })
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
