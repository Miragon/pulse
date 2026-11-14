// @vitest-environment happy-dom
import { createRef, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { DataTable } from "./data-table.js"
import type { DataTableColumn } from "./data-table-types.js"
import { Td } from "./table.js"

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

describe("DataTable: the frame (WCAG 1.4.10, 2.4.11)", () => {
  it("scrolls inside a named region a keyboard can reach, its table named the same", () => {
    render(<DataTable label="Orders" columns={COLUMNS} rows={ORDERS} rowKey={(row) => row.id} />)
    const region = screen.getByRole("region", { name: "Orders" })
    expect(region.getAttribute("tabindex")).toBe("0")
    expect(classes(region)).toEqual(
      expect.arrayContaining(["overflow-auto", "@container", "min-w-0", "peer"]),
    )
    // Positioned: text out of flow in a cell (sr-only) clips with the region, never widening
    // the document.
    expect(classes(region)).toContain("relative")
    expect(region.contains(screen.getByRole("table", { name: "Orders" }))).toBe(true)
  })

  it("keeps a focused row clear of the sticky head: scroll padding of one row", () => {
    render(<DataTable label="Orders" columns={COLUMNS} rows={ORDERS} rowKey={(row) => row.id} />)
    expect(classes(screen.getByRole("region"))).toContain("scroll-pt-row")
    const head = screen.getByRole("table").querySelector("thead")
    expect(classes(head)).toEqual(expect.arrayContaining(["sticky", "top-0", "z-[2]"]))
    // The head cells paint the table's surface, so rows scrolling under them stay hidden.
    for (const cell of screen.getAllByRole("columnheader")) {
      expect(classes(cell)).toContain("bg-[var(--table-surface,var(--card))]")
    }
  })

  it("draws the region's focus ring inside its own box, on a sibling no row fill covers", () => {
    render(<DataTable label="Orders" columns={COLUMNS} rows={ORDERS} rowKey={(row) => row.id} />)
    const ring = screen.getByRole("region").nextElementSibling as HTMLElement
    expect(ring.getAttribute("data-slot")).toBe("data-table-ring")
    expect(ring.getAttribute("aria-hidden")).toBe("true")
    expect(classes(ring)).toEqual(
      expect.arrayContaining([
        "absolute",
        "inset-0",
        "pointer-events-none",
        "z-[3]",
        "peer-focus-visible:outline-(length:--focus-width)",
        "peer-focus-visible:-outline-offset-2",
      ]),
    )
    expect(classes(screen.getByRole("region")).some((name) => name.includes("ring"))).toBe(false)
  })

  it("draws no outline on the region itself, so forced colours draw none either", () => {
    render(<DataTable label="Orders" columns={COLUMNS} rows={ORDERS} rowKey={(row) => row.id} />)
    const region = classes(screen.getByRole("region"))
    expect(region).toContain("focus-visible:outline-none")
    expect(region.some((name) => name.includes("outline-hidden"))).toBe(false)
  })
})

describe("DataTable: rows drawn by the columns", () => {
  it("draws a head per column and a one-line cell per column and row", () => {
    render(<DataTable label="Orders" columns={COLUMNS} rows={ORDERS} rowKey={(row) => row.id} />)
    expect(screen.getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual([
      "Name",
      "Total",
    ])
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1)
    expect(rows.map((row) => row.textContent)).toEqual(["Bike3", "Helmet1", "Lock2"])
    const total = screen.getByRole("cell", { name: "3" })
    expect(classes(total)).toEqual(expect.arrayContaining(["whitespace-nowrap", "text-right"]))
    expect(classes(total)).toEqual(expect.arrayContaining(["h-row", "px-cell"]))
  })

  /** The head and body cells of each column, in column order. */
  const cellsByColumn = (table: HTMLElement) =>
    Array.from(table.querySelectorAll("thead th")).map((head, index) => [
      head,
      ...Array.from(table.querySelectorAll(`tbody tr > :nth-child(${index + 1})`)),
    ])

  it("fits each column to its content, one line each, and gives the last one the rest", () => {
    render(<DataTable label="Orders" columns={COLUMNS} rows={ORDERS} rowKey={(row) => row.id} />)
    const [name, total] = cellsByColumn(screen.getByRole("table"))
    for (const cell of [...name, ...total]) expect(classes(cell)).toContain("whitespace-nowrap")
    // A fitting column holds a NamedId whole; the last one takes the rest and lets it give way.
    for (const cell of name) {
      expect(classes(cell)).toEqual(
        expect.arrayContaining(["w-[1%]", "[--named-id-floor:max-content]"]),
      )
    }
    for (const cell of total) expect(classes(cell)).not.toContain("w-[1%]")
  })

  it("gives the rest to the column marked fill instead, which cuts its NamedId first", () => {
    render(
      <DataTable
        label="Orders"
        columns={[{ ...COLUMNS[0], fill: true }, COLUMNS[1]]}
        rows={ORDERS}
        rowKey={(row) => row.id}
      />,
    )
    const [name, total] = cellsByColumn(screen.getByRole("table"))
    for (const cell of name) expect(classes(cell)).not.toContain("w-[1%]")
    for (const cell of total) expect(classes(cell)).toContain("w-[1%]")
  })

  it("fills every body row on hover from the --accent role, drawn or composed by hand", () => {
    render(<DataTable label="Orders" columns={COLUMNS} rows={ORDERS} rowKey={(row) => row.id} />)
    const drawn = screen.getByRole("table", { name: "Orders" }).querySelector("tbody")
    expect(classes(drawn)).toContain("[&>tr:hover]:bg-accent")
    render(
      <DataTable label="Hand" columns={[{ key: "a", label: "A" }]}>
        <tr>
          <Td>a</Td>
        </tr>
      </DataTable>,
    )
    const hand = screen.getByRole("table", { name: "Hand" }).querySelector("tbody")
    expect(classes(hand)).toContain("[&>tr:hover]:bg-accent")
  })

  it("shows what is empty under the head, and no row", () => {
    render(
      <DataTable
        label="Orders"
        columns={COLUMNS}
        rows={[]}
        rowKey={(row) => row.id}
        empty={<p>No orders</p>}
      />,
    )
    expect(screen.getByText("No orders")).toBeTruthy()
    expect(screen.getAllByRole("columnheader")).toHaveLength(2)
    expect(screen.getByRole("table").querySelectorAll("tbody tr")).toHaveLength(0)
  })

  it("puts its footer under the table, inside the region", () => {
    render(
      <DataTable
        label="Orders"
        columns={COLUMNS}
        rows={ORDERS}
        rowKey={(row) => row.id}
        footer={<button type="button">Load more</button>}
      />,
    )
    const more = screen.getByRole("button", { name: "Load more" })
    expect(screen.getByRole("region").contains(more)).toBe(true)
  })

  it("stands in with 8 px bars while it loads, hidden from assistive tech, and says it is busy", () => {
    render(
      <DataTable
        label="Orders"
        columns={COLUMNS}
        rows={ORDERS}
        rowKey={(row) => row.id}
        skeletonRows={4}
      />,
    )
    const region = screen.getByRole("region")
    expect(region.getAttribute("aria-busy")).toBe("true")
    const body = region.querySelector("[data-slot='data-table-skeleton']")!
    expect(body.getAttribute("aria-hidden")).toBe("true")
    expect(body.querySelectorAll("tr")).toHaveLength(4)
    const bar = body.querySelector("td span")!
    expect(classes(bar)).toEqual(expect.arrayContaining(["h-2", "bg-accent"]))
    expect(screen.queryAllByRole("columnheader")).toHaveLength(0)
    expect(screen.queryByText("Bike")).toBeNull()
  })
})

describe("DataTable: rows composed by hand (ListTable's way)", () => {
  it("renders them in its body with the head rows above the heads and a foot after", () => {
    const body = createRef<HTMLTableSectionElement>()
    render(
      <DataTable
        label="Engines"
        columns={[
          { key: "0", label: "Engine" },
          { key: "1", label: "Running", align: "right" },
        ]}
        headRows={
          <tr data-testid="groups">
            <th scope="col" colSpan={2}>
              Load
            </th>
          </tr>
        }
        foot={
          <tfoot>
            <tr>
              <td colSpan={2}>Showing 1 of 2</td>
            </tr>
          </tfoot>
        }
        bodyRef={body}
        tableClassName="own-table"
      >
        <tr>
          <Td>prod</Td>
          <Td align="right">4</Td>
        </tr>
      </DataTable>,
    )
    const table = screen.getByRole("table", { name: "Engines" })
    expect(classes(table)).toContain("own-table")
    const headRows = table.querySelectorAll("thead tr")
    expect(headRows[0]?.getAttribute("data-testid")).toBe("groups")
    expect(headRows[1]?.textContent).toBe("EngineRunning")
    expect(body.current?.textContent).toBe("prod4")
    expect(table.querySelector("tfoot")?.textContent).toBe("Showing 1 of 2")
    // Hand-composed rows lay out by their content: no content-fit widths on the heads.
    for (const head of screen.getAllByRole("columnheader")) {
      expect(classes(head)).not.toContain("w-[1%]")
    }
  })
})

describe("DataTable: the heads", () => {
  it("keeps each caption on one line, or lets it wrap in a wide table of figures", () => {
    const { rerender } = render(
      <DataTable label="Engines" columns={[{ key: "0", label: "Jobs without retries" }]}>
        <tr>
          <Td>0</Td>
        </tr>
      </DataTable>,
    )
    const head = () => classes(screen.getByRole("columnheader"))
    expect(head()).toContain("whitespace-nowrap")
    expect(head()).not.toContain("whitespace-normal")
    rerender(
      <DataTable label="Engines" columns={[{ key: "0", label: "Jobs without retries" }]} wrapHeads>
        <tr>
          <Td>0</Td>
        </tr>
      </DataTable>,
    )
    // The kit's cn keeps the later of the two.
    expect(head()).toContain("whitespace-normal")
    expect(head()).not.toContain("whitespace-nowrap")
  })
})

describe("DataTable: a row as a target (keyboard and pointer)", () => {
  function Orders({ onActivate = vi.fn(), onCopy = vi.fn() }) {
    return (
      <DataTable
        label="Orders"
        columns={[
          ...COLUMNS,
          {
            key: "act",
            plain: true,
            cell: (row) => (
              <button type="button" onClick={() => undefined}>
                Retry {row.id}
              </button>
            ),
          },
        ]}
        rows={ORDERS}
        rowKey={(row) => row.id}
        onActivate={onActivate}
        onCopy={onCopy}
      />
    )
  }
  const bodyRows = () =>
    Array.from(screen.getByRole("table").querySelectorAll<HTMLElement>("tbody tr"))

  it("gives the rows one tab stop, the first, with the focus drawn inside the row", () => {
    render(<Orders />)
    const [first, second] = bodyRows()
    expect(first?.getAttribute("tabindex")).toBe("0")
    expect(second?.getAttribute("tabindex")).toBe("-1")
    expect(classes(first ?? null)).toEqual(
      expect.arrayContaining([
        "cursor-pointer",
        "outline-none",
        "focus-visible:outline-(length:--focus-width)",
        "focus-visible:-outline-offset-(--focus-width)",
      ]),
    )
    // No transparent outline at rest, which forced colours would draw around every row.
    expect(classes(first ?? null)).not.toContain("outline-hidden")
    // The rows reach the region themselves: no second tab stop on it.
    expect(screen.getByRole("region").hasAttribute("tabindex")).toBe(false)
  })

  it("moves with the arrows, Home and End, and the tab stop follows", () => {
    render(<Orders />)
    const rows = bodyRows()
    rows[0].focus()
    fireEvent.keyDown(rows[0], { key: "ArrowDown" })
    expect(document.activeElement).toBe(rows[1])
    expect(rows[1].getAttribute("tabindex")).toBe("0")
    expect(rows[0].getAttribute("tabindex")).toBe("-1")
    fireEvent.keyDown(rows[1], { key: "End" })
    expect(document.activeElement).toBe(rows[2])
    fireEvent.keyDown(rows[2], { key: "ArrowDown" })
    expect(document.activeElement).toBe(rows[2])
    fireEvent.keyDown(rows[2], { key: "Home" })
    expect(document.activeElement).toBe(rows[0])
    fireEvent.keyDown(rows[0], { key: "ArrowUp" })
    expect(document.activeElement).toBe(rows[0])
  })

  it("opens a row on Enter or a click, beside the view with Ctrl or Cmd", () => {
    const onActivate = vi.fn()
    render(<Orders onActivate={onActivate} />)
    const [first, second] = bodyRows()
    fireEvent.keyDown(first, { key: "Enter" })
    fireEvent.keyDown(first, { key: "Enter", ctrlKey: true })
    fireEvent.click(within(second).getByText("Helmet"))
    fireEvent.click(within(second).getByText("Helmet"), { metaKey: true })
    expect(onActivate.mock.calls).toEqual([
      [ORDERS[0], { toSide: false }],
      [ORDERS[0], { toSide: true }],
      [ORDERS[1], { toSide: false }],
      [ORDERS[1], { toSide: true }],
    ])
  })

  it("leaves a control in the row to itself: its click and its keys open nothing", () => {
    const onActivate = vi.fn()
    render(<Orders onActivate={onActivate} />)
    const retry = screen.getByRole("button", { name: "Retry o-1" })
    fireEvent.click(retry)
    fireEvent.keyDown(retry, { key: "Enter" })
    fireEvent.keyDown(retry, { key: "ArrowDown" })
    expect(onActivate).not.toHaveBeenCalled()
  })

  it("copies what a focused row names on Ctrl or Cmd with C", () => {
    const onCopy = vi.fn()
    render(<Orders onCopy={onCopy} />)
    const [first] = bodyRows()
    fireEvent.keyDown(first, { key: "c", ctrlKey: true })
    fireEvent.keyDown(first, { key: "C", metaKey: true })
    fireEvent.keyDown(first, { key: "c" })
    expect(onCopy.mock.calls).toEqual([[ORDERS[0]], [ORDERS[0]]])
  })

  it("keeps focus on the row at the same place when the rows change under it", () => {
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true)
    function Live() {
      const [rows, setRows] = useState(ORDERS)
      return (
        <>
          <button
            type="button"
            onClick={() => setRows(ORDERS.map((order) => ({ ...order, id: `${order.id}-next` })))}
          >
            update
          </button>
          <DataTable
            label="Orders"
            columns={COLUMNS}
            rows={rows}
            rowKey={(row) => row.id}
            onActivate={() => undefined}
          />
        </>
      )
    }
    render(<Live />)
    bodyRows()[1].focus()
    // A live update replaces every row's element: focus goes to the row now in the same place.
    fireEvent.click(screen.getByRole("button", { name: "update" }))
    expect(document.activeElement).toBe(bodyRows()[1])
    expect(document.activeElement?.textContent).toBe("Helmet1")
    hasFocus.mockRestore()
  })
})
