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
    // The arrow stays next to the label on the cell's own side.
    expect(classes(duration?.firstElementChild ?? null)).toContain("flex-row-reverse")
  })

  it("a plain header keeps only the border and padding", () => {
    inTable(<Th plain />)
    const cell = screen.getByRole("columnheader")
    expect(classes(cell)).not.toContain("text-muted-foreground")
  })
})

describe("Td", () => {
  it("sets the dense step and aligns right on request", () => {
    render(
      <table>
        <tbody>
          <tr>
            <Td>left</Td>
            <Td align="right">right</Td>
          </tr>
        </tbody>
      </table>,
    )
    expect(classes(screen.getByText("left"))).toContain("text-dense")
    expect(classes(screen.getByText("left"))).not.toContain("text-right")
    expect(classes(screen.getByText("right"))).toContain("text-right")
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
