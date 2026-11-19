// @vitest-environment happy-dom
import { Fragment, useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ListFooter } from "./ListFooter.js"
import { PagedListFooter } from "./PagedListFooter.js"

afterEach(cleanup)

const PAGE = 2

/**
 * A paged list as the views compose one: a table of rows, then its footer. `focusable` rows take
 * focus as a table's rows that open do (one tab stop, the others `tabindex="-1"`); `pages` is how
 * many pages exist, so the button goes on the last.
 */
function List({
  total,
  focusable = true,
  paged = false,
  continued = [],
}: {
  total: number
  focusable?: boolean
  paged?: boolean
  /** The rows a row continues (an error under its row, `FIT_CONTINUES_ROW`), by their text. */
  continued?: readonly string[]
}) {
  const [shown, setShown] = useState(PAGE)
  const [loading, setLoading] = useState(false)
  const loadMore = () => {
    setLoading(true)
    // The next page arrives later, as a feed's answer does.
    setTimeout(() => {
      setShown((n) => Math.min(n + PAGE, total))
      setLoading(false)
    }, 0)
  }
  const rows = Array.from({ length: shown }, (_, index) => `Row ${index + 1}`)
  const footer = paged ? (
    <PagedListFooter
      paged={{ items: rows, total, hasMore: shown < total, loadMore, loadingMore: loading }}
      noun="rows"
    />
  ) : (
    <ListFooter
      shown={shown}
      total={total}
      hasMore={shown < total}
      loadingMore={loading}
      onLoadMore={loadMore}
      noun="rows"
    />
  )
  return (
    <div>
      <table>
        <tbody>
          {rows.map((row, index) => (
            <Fragment key={row}>
              <tr tabIndex={focusable ? (index === 0 ? 0 : -1) : undefined}>
                <td>{row}</td>
              </tr>
              {continued.includes(row) && (
                // widget-shell's `FIT_CONTINUES_ROW`, as a job's failed retry renders under its row.
                <tr data-inline-fit-continues="">
                  <td>{`${row} failed`}</td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      {footer}
    </div>
  )
}

const loadMore = () => screen.getByRole("button", { name: "Load more" })

describe("ListFooter: focus after Load more goes on, never to the page's body", () => {
  it("focuses the first new row of the table above it", async () => {
    render(<List total={6} />)
    loadMore().focus()
    fireEvent.click(loadMore())
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Row 3"))
  })

  it("counts no row that continues the one above it: the first new row is the first new item's", async () => {
    render(<List total={6} continued={["Row 1"]} />)
    loadMore().focus()
    fireEvent.click(loadMore())
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Showing 4 of 6 rows"))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(document.activeElement?.textContent).toBe("Row 3")
  })

  it("does so through PagedListFooter too", async () => {
    render(<List total={6} paged />)
    fireEvent.click(loadMore())
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Row 3"))
  })

  it("focuses the status line on the last page where no row takes focus: the button is gone", async () => {
    render(<List total={3} focusable={false} />)
    loadMore().focus()
    fireEvent.click(loadMore())
    await waitFor(() => expect(screen.queryByRole("button")).toBeNull())
    const status = screen.getByRole("status")
    await waitFor(() => expect(document.activeElement).toBe(status))
    expect(status.textContent).toBe("Showing 3 of 3 rows")
    expect(status.tabIndex).toBe(-1)
  })

  it("keeps focus on the button while there is a next page and no row takes focus", async () => {
    render(<List total={9} focusable={false} />)
    loadMore().focus()
    fireEvent.click(loadMore())
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Showing 4 of 9 rows"))
    // Past the footer's move, which runs after the rows' effects: the button, natively focusable
    // without a tabindex, keeps focus, the status line does not take it.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(document.activeElement).toBe(loadMore())
  })

  it("never takes focus back from where the reader moved it meanwhile", async () => {
    render(
      <>
        <List total={6} />
        <input aria-label="Elsewhere" />
      </>,
    )
    fireEvent.click(loadMore())
    const elsewhere = screen.getByRole("textbox", { name: "Elsewhere" })
    elsewhere.focus()
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Showing 4 of 6 rows"))
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(document.activeElement).toBe(elsewhere)
  })

  it("moves nothing when the rows change without Load more (a refetch)", async () => {
    const { rerender } = render(
      <ListFooter shown={2} total={6} hasMore onLoadMore={() => undefined} noun="rows" />,
    )
    document.body.focus()
    rerender(<ListFooter shown={4} total={6} hasMore onLoadMore={() => undefined} noun="rows" />)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(document.activeElement).toBe(document.body)
  })
})
