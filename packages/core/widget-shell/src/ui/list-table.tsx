import { Children, useId, type ReactNode } from "react"
import { Button, cn, MICRO_LABEL, useLocale } from "@miragon/mcp-toolkit-ui"
import { Maximize2 } from "lucide-react"
import { formatNumber } from "./format.js"
import { Icon } from "./icon.js"
import { useInlineBudget, useRowsBudgeted } from "./inline-budget.js"
import { useInlineRows } from "./inline-fit.js"
import { kitLabels } from "./kit-labels.js"
import { Th, type ColumnSort } from "./table.js"

/**
 * Focus ring as an inward outline on a sibling over the region: an outset ring
 * is clipped by the card (WCAG 2.4.7), and the row fills and the pinned column
 * paint over the region's own shadow or outline.
 */
export const REGION_FOCUS_RING =
  "peer-focus-visible:outline-2 peer-focus-visible:outline-solid peer-focus-visible:outline-focus peer-focus-visible:-outline-offset-2"

/** Above the pinned column's `z-index: 1` (see {@link listTableCss}). */
const RING_LAYER = "pointer-events-none absolute inset-0 z-[2] rounded-sm"

/** Container-query widths of the region itself; `md` hides in a 760 px inline view, shows in fullscreen. */
export const COLUMN_BREAKPOINTS = { sm: "40rem", md: "48rem", lg: "64rem" } as const

export type ColumnBreakpoint = keyof typeof COLUMN_BREAKPOINTS

export interface ListTableColumn {
  label?: ReactNode
  align?: "left" | "right"
  /** Bare header cell without the MICRO_LABEL treatment (actions column). */
  plain?: boolean
  className?: string
  /** Hidden while the region is narrower; never on the identifying column or the row actions. */
  hideBelow?: ColumnBreakpoint
  /**
   * Pins the LAST column (row actions) to the right edge while scrolling. Rows
   * then paint the card surface; another surface sets `--list-table-surface`.
   */
  sticky?: boolean
  sort?: ColumnSort
}

/**
 * A head over adjacent columns. Groups cover the columns left to right; a
 * column under a multi-column group never hides, since the span would not shrink.
 */
export interface ListTableGroup {
  label?: ReactNode
  span?: number
}

function groupLayout(
  columns: ReadonlyArray<ListTableColumn>,
  groups: ReadonlyArray<ListTableGroup>,
): Array<{ position: number; first: number; span: number }> {
  let first = 0
  const layout = groups.map((group, index) => {
    const span = group.span ?? 1
    if (!Number.isInteger(span) || span < 1) {
      throw new Error(`ListTable: group ${index + 1} spans ${span} columns; a span is 1 or more`)
    }
    const entry = { position: index + 1, first, span }
    first += span
    return entry
  })
  if (first !== columns.length) {
    throw new Error(
      `ListTable: the groups cover ${first} columns, the table has ${columns.length}; cover each column once`,
    )
  }
  for (const { first: start, span } of layout) {
    if (span === 1) continue
    const hidden = columns.slice(start, start + span).findIndex((c) => c.hideBelow)
    if (hidden >= 0) {
      throw new Error(
        `ListTable: column ${start + hidden + 1} hides, but sits under a group of ${span}; a column under a group of several never hides`,
      )
    }
  }
  return layout
}

function hideRules(cell: string, below: ColumnBreakpoint): string[] {
  const width = COLUMN_BREAKPOINTS[below]
  return [
    `${cell} { display: none; }`,
    `@container (min-width: ${width}) { ${cell} { display: table-cell; } }`,
  ]
}

/** Rules address cell POSITIONS, so a hand-composed row cannot drift from its header. */
export function listTableCss(
  scope: string,
  columns: ReadonlyArray<ListTableColumn>,
  groups?: ReadonlyArray<ListTableGroup>,
): string {
  const at = `[data-list-table="${scope}"]`
  const rows = groups ? `${at} tr:not([data-list-table-groups])` : `${at} tr`
  const groupRow = `${at} tr[data-list-table-groups]`
  const layout = groups ? groupLayout(columns, groups) : []
  const ownGroupCell = (index: number) => {
    const group = layout.find((g) => g.first === index && g.span === 1)
    return group ? `${groupRow} > :nth-child(${group.position})` : undefined
  }
  const rules: string[] = []
  columns.forEach((column, index) => {
    const cells = [`${rows} > :nth-child(${index + 1})`, ownGroupCell(index)].filter(
      (cell): cell is string => cell !== undefined,
    )
    if (column.hideBelow) {
      for (const cell of cells) rules.push(...hideRules(cell, column.hideBelow))
    }
    if (column.sticky && index === columns.length - 1) {
      if (groups && !ownGroupCell(index)) {
        throw new Error("ListTable: the pinned last column needs a group of its own")
      }
      // The pinned cell inherits its row's background (hover, selection); `:where` lets a row's own class win.
      rules.push(
        `:where(${at} tbody tr) { background-color: var(--list-table-surface, var(--card)); }`,
        `:where(${at} thead tr) { background-color: var(--muted); }`,
        ...cells.map(
          (cell) =>
            `${cell} { position: sticky; right: 0; z-index: 1; background-color: inherit; }`,
        ),
      )
    }
  })
  return rules.join("\n")
}

/** Heads use `scope="col"`: `colgroup` would need `<col>` elements, which keep hidden columns in the table model. */
function GroupRow({ groups }: { groups: ReadonlyArray<ListTableGroup> }) {
  return (
    <tr data-list-table-groups="">
      {groups.map((group, index) =>
        group.label === undefined ? (
          <td key={index} colSpan={group.span ?? 1} className="border-border border-t" />
        ) : (
          <th
            key={index}
            scope="col"
            colSpan={group.span ?? 1}
            className={cn(
              "border-border text-foreground border-t border-l px-4 pt-2.5 pb-1 text-center",
              MICRO_LABEL,
            )}
          >
            {group.label}
          </th>
        ),
      )}
    </tr>
  )
}

/**
 * The table frame; rows stay hand-composed per widget since cells differ.
 * Inside `PagedRows` it hands its body to the paged fit instead of capping twice.
 */
export function ListTable({
  columns,
  groups,
  ariaLabel,
  className,
  children,
}: {
  columns: ReadonlyArray<ListTableColumn>
  /** Heads over adjacent columns, in a row above the column heads ({@link ListTableGroup}). */
  groups?: ReadonlyArray<ListTableGroup>
  ariaLabel: string
  className?: string
  children: ReactNode
}) {
  const scope = useId()
  const css = listTableCss(scope, columns, groups)
  const budget = useInlineBudget()
  const paged = useRowsBudgeted()
  const rows = Children.toArray(children)
  const own = useInlineRows(rows.length, { enabled: paged === null })
  const cap = paged ? null : own.cap
  const capped = cap !== null && rows.length > cap
  const showMore = budget.expand ?? (() => own.reveal(own.step))
  return (
    // The frame does not scroll, so the ring stays put.
    <div className="relative w-full min-w-0">
      <div
        role="region"
        aria-label={ariaLabel}
        // A scrollable region must be reachable by keyboard to scroll it.
        tabIndex={0}
        data-list-table={scope}
        className="peer @container w-full min-w-0 overflow-x-auto rounded-sm focus-visible:outline-hidden"
      >
        {css && <style>{css}</style>}
        <table
          className={cn("text-dense w-full border-collapse", className)}
          aria-label={ariaLabel}
        >
          <thead className="bg-muted">
            {groups && <GroupRow groups={groups} />}
            <tr>
              {columns.map((column, index) => (
                <Th
                  key={index}
                  align={column.align}
                  plain={column.plain}
                  sort={column.sort}
                  className={column.className}
                >
                  {column.label}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody ref={paged ? paged.attachRows : own.attachRows}>
            {/* Same keyed rows either way, so a changing cap never remounts them. */}
            {capped ? rows.slice(0, cap) : rows}
          </tbody>
          {capped && (
            <MoreRows
              colSpan={columns.length}
              shown={cap}
              total={rows.length}
              fullscreen={budget.expand !== null}
              onShowMore={showMore}
            />
          )}
        </table>
      </div>
      <span
        aria-hidden="true"
        data-list-table-ring=""
        className={cn(RING_LAYER, REGION_FOCUS_RING)}
      />
    </div>
  )
}

/** In `<tfoot>` so body position rules miss it; inline `display` beats a hidden column's rule. */
function MoreRows({
  colSpan,
  shown,
  total,
  fullscreen,
  onShowMore,
}: {
  colSpan: number
  shown: number
  total: number
  fullscreen: boolean
  onShowMore: () => void
}) {
  const labels = kitLabels(useLocale())
  return (
    <tfoot>
      <tr data-list-table-more="">
        <td
          colSpan={colSpan}
          style={{ display: "table-cell" }}
          className="border-border border-t px-4 py-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-small" aria-live="polite">
              {labels.rowsShown({ shown: formatNumber(shown), total: formatNumber(total) })}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onShowMore}>
              {fullscreen && <Icon icon={Maximize2} dense />}
              {fullscreen ? labels.showAll : labels.showMore}
            </Button>
          </div>
        </td>
      </tr>
    </tfoot>
  )
}
