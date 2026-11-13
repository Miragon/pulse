// @vitest-environment happy-dom
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { TableEmptyState, Td, Th, VersionChip } from "./table.js"

/** The table cells and the empty state every list shares. */

afterEach(cleanup)

const classes = (el: Element | null) => (el?.getAttribute("class") ?? "").split(/\s+/)

function inTable(cells: ReactNode) {
  return render(
    <table>
      <thead>
        <tr>{cells}</tr>
      </thead>
    </table>,
  )
}

describe("Th", () => {
  it("is a column header on the micro label, aligned as asked", () => {
    inTable(
      <>
        <Th>Name</Th>
        <Th align="right">Count</Th>
      </>,
    )
    const [name, count] = screen.getAllByRole("columnheader")
    expect(name?.getAttribute("scope")).toBe("col")
    expect(classes(name ?? null)).toContain("text-left")
    expect(classes(count ?? null)).toContain("text-right")
    expect(name?.getAttribute("aria-sort")).toBeNull()
  })

  it("sits on the row height and the cell's padding, 13/600 quiet, with one rule below", () => {
    inTable(<Th>Name</Th>)
    const c = classes(screen.getByRole("columnheader"))
    expect(c).toEqual(
      expect.arrayContaining([
        "h-row",
        "px-cell",
        "py-0",
        "text-small",
        "font-semibold",
        "text-muted-foreground",
        "border-b",
      ]),
    )
    // One line: a caption never wraps the head over the row height (a NamedId's line gives way
    // first, then the table scrolls inside its region).
    expect(c).toContain("whitespace-nowrap")
    // Only the rule below: no box around the head.
    expect(c).not.toContain("border-y")
    expect(c).not.toContain("border-t")
    // The table's surface, so a sticky head covers the rows scrolling under it.
    expect(c).toContain("bg-[var(--table-surface,var(--card))]")
  })

  it("states its sort for assistive tech and draws the matching Lucide arrow", () => {
    inTable(
      <>
        <Th sort="ascending">Started</Th>
        <Th sort="descending" align="right">
          Duration
        </Th>
      </>,
    )
    const [started, duration] = screen.getAllByRole("columnheader")
    expect(started?.getAttribute("aria-sort")).toBe("ascending")
    expect(started?.querySelector("svg.lucide-arrow-up")).toBeTruthy()
    expect(duration?.getAttribute("aria-sort")).toBe("descending")
    expect(duration?.querySelector("svg.lucide-arrow-down")).toBeTruthy()
    // The arrow stays next to the label on the cell's own side, 12 px beside the 13 px caption.
    expect(classes(duration?.firstElementChild ?? null)).toContain("flex-row-reverse")
    expect(started?.querySelector("svg")?.getAttribute("width")).toBe("12")
  })

  it("a plain header keeps only the rule, the height and the padding", () => {
    inTable(<Th plain />)
    const c = classes(screen.getByRole("columnheader"))
    expect(c).not.toContain("text-muted-foreground")
    expect(c).toEqual(expect.arrayContaining(["h-row", "px-cell", "border-b"]))
  })
})

function inRow(cells: ReactNode) {
  return render(
    <table>
      <tbody>
        <tr>{cells}</tr>
      </tbody>
    </table>,
  )
}

describe("Td", () => {
  it("sets the dense step and aligns right on request", () => {
    inRow(
      <>
        <Td>left</Td>
        <Td align="right">right</Td>
      </>,
    )
    expect(classes(screen.getByText("left"))).toContain("text-dense")
    expect(classes(screen.getByText("left"))).not.toContain("text-right")
    expect(classes(screen.getByText("right"))).toContain("text-right")
  })

  it("takes the row height as a minimum and the cell's padding, one rule below", () => {
    inRow(<Td>cell</Td>)
    const c = classes(screen.getByRole("cell"))
    expect(c).toEqual(expect.arrayContaining(["h-row", "px-cell", "border-b", "align-middle"]))
    // The cell's padding above and below, at most half of what a 24 px control leaves of the row:
    // a one-line row is the row height exactly.
    expect(c).toContain("py-[min(var(--cell-py),calc((var(--row-h)_-_var(--control-h-xs))/2))]")
    // Text may still wrap into a taller row (200 % text): no forced single line.
    expect(c).not.toContain("whitespace-nowrap")
    expect(c).not.toContain("truncate")
  })

  it("truncates to one line on request, with the whole text in its title and its name", () => {
    inRow(
      <>
        <Td truncate>java.lang.IllegalStateException: no invoice</Td>
        <Td truncate title="the whole order note">
          <span>the whole…</span>
        </Td>
      </>,
    )
    const [plain, rich] = screen.getAllByRole("cell")
    expect(classes(plain ?? null)).toContain("truncate")
    expect(plain?.getAttribute("title")).toBe("java.lang.IllegalStateException: no invoice")
    // A screen reader reads the cell's text, not what shows.
    expect(plain?.textContent).toBe("java.lang.IllegalStateException: no invoice")
    expect(rich?.getAttribute("title")).toBe("the whole order note")
  })

  it("spans columns on request", () => {
    inRow(<Td colSpan={3}>wide</Td>)
    expect(screen.getByRole("cell").getAttribute("colspan")).toBe("3")
  })
})

describe("TableEmptyState", () => {
  it("says what is empty in a card, neutral by default", () => {
    const { container } = render(
      <TableEmptyState description="Nothing yet.">No rows</TableEmptyState>,
    )
    expect(screen.getByText("No rows").tagName).toBe("P")
    expect(screen.getByText("Nothing yet.")).toBeTruthy()
    expect(container.firstElementChild?.getAttribute("data-empty-variant")).toBe("empty")
    expect(container.querySelector("svg.lucide-inbox")).toBeTruthy()
  })

  it("reads all clear in the success tone, never like missing data", () => {
    const { container } = render(
      <TableEmptyState variant="done">No open incidents</TableEmptyState>,
    )
    expect(container.firstElementChild?.getAttribute("data-empty-variant")).toBe("done")
    expect(container.querySelector("svg.lucide-circle-check")).toBeTruthy()
  })

  it("takes a situation icon, a heading level and the actions", () => {
    render(
      <TableEmptyState
        icon={<svg data-testid="own" />}
        titleAs="h3"
        action={<button type="button">Reset</button>}
        secondaryAction={<button type="button">Help</button>}
      >
        No matches
      </TableEmptyState>,
    )
    expect(screen.getByRole("heading", { level: 3, name: "No matches" })).toBeTruthy()
    expect(screen.getByTestId("own")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reset" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Help" })).toBeTruthy()
  })
})

describe("VersionChip", () => {
  it("prefixes the version with v in mono caption text", () => {
    render(<VersionChip version="3" />)
    const chip = screen.getByText("v3")
    expect(classes(chip)).toEqual(expect.arrayContaining(["font-mono", "text-small"]))
  })
})
