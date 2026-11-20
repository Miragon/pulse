// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TestViewHost } from "@miragon/pulse-widget-shell/widgets"
import { useInstanceSlots } from "../src/screens/instance/instance-slots.js"

/**
 * The page's slots of an instance's blocks: its plain table at the height its tab leaves it, a
 * column a narrow region drops, an empty table in the kit's words; its link a link of the page.
 */

afterEach(cleanup)

interface Row {
  readonly id: string
}

function Tables({ rows }: { readonly rows: readonly Row[] }) {
  const { PlainTable, Link } = useInstanceSlots(vi.fn())
  return (
    <>
      <PlainTable<Row>
        name="history"
        label="History"
        columns={[
          { key: "id", label: "Element", cell: (row) => row.id },
          { key: "since", label: "Since", cell: () => "now", hideBelow: "40rem" },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        empty="Nothing here yet."
      />
      <Link
        rel="caller"
        target={{ kind: "instance", engine: "prod-a", instanceId: "pi-0" }}
        title="Open the calling instance pi-0"
      >
        from pi-0
      </Link>
    </>
  )
}

const renderTables = (rows: readonly Row[]) =>
  render(
    <TestViewHost tools={{}} locale="en" writes={false} followUp="none">
      <Tables rows={rows} />
    </TestViewHost>,
  )

describe("the page's slots of an instance's blocks", () => {
  it("lays out a table that fills its tab, its rows plain, a column dropped in a narrow region", () => {
    renderTables([{ id: "Task_A" }])
    const table = screen.getByRole("table", { name: "History" })
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1)
    expect(table.closest("[data-list-table]")?.className).toContain("flex-1")
    expect(document.head.innerHTML + document.body.innerHTML).toContain("display: none")
    expect(screen.getByRole("link", { name: "from pi-0" }).getAttribute("href")).toBe(
      "/app/engines/prod-a/instances/pi-0",
    )
  })

  it("says an empty table in the block's words", () => {
    renderTables([])
    expect(screen.getByText("Nothing here yet.")).toBeTruthy()
    expect(screen.queryByRole("table")).toBeNull()
  })
})
