import type { ReactNode } from "react"
import { screen } from "@testing-library/react"
import { LocaleProvider } from "@miragon/mcp-toolkit-ui"
import { InlineBudgetProvider, type InlineBudget } from "./inline-budget.js"
import { InlineFitBox, type FitMeasure } from "./inline-fit.js"
import { ListTable } from "./list-table.js"

/** happy-dom has no layout, so the inline-fit tests inject one. */

export function layout({
  chrome,
  row,
  footer = 40,
}: {
  chrome: number
  row: number
  footer?: number
}) {
  const measure: FitMeasure = {
    rows: (element) => Array.from(element.children).map((_, i) => chrome + (i + 1) * row),
    content: (box) =>
      chrome +
      box.querySelectorAll("[data-inline-fit-rows] > *").length * row +
      box.querySelectorAll("tfoot, [data-slot='list-footer']").length * footer,
  }
  return measure
}

export const ROWS = Array.from({ length: 12 }, (_, i) => `row ${i + 1}`)

export function Table({ rows = ROWS }: { rows?: string[] }) {
  return (
    <ListTable ariaLabel="Things" columns={[{ label: "Name" }]}>
      {rows.map((row) => (
        <tr key={row}>
          <td>{row}</td>
        </tr>
      ))}
    </ListTable>
  )
}

export const shownRows = () =>
  screen
    .queryAllByRole("cell")
    .map((cell) => cell.textContent ?? "")
    .filter((text) => text.startsWith("row "))

export function Host({
  budget = 600,
  active = true,
  expand = null,
  measure,
  children,
}: {
  budget?: number
  active?: boolean
  expand?: (() => void) | null
  measure: FitMeasure
  children: ReactNode
}) {
  const inline: InlineBudget = { diagramMaxHeight: null, expand }
  return (
    <LocaleProvider locale="en">
      <InlineBudgetProvider budget={inline}>
        <InlineFitBox active={active} budget={budget} measure={measure}>
          {children}
        </InlineFitBox>
      </InlineBudgetProvider>
    </LocaleProvider>
  )
}
