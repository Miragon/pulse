import { Children, useId, type ReactNode } from "react"
import {
  Button,
  cn,
  DataTable,
  MICRO_LABEL,
  useLocale,
  formatNumber,
  Icon,
  type ColumnSort,
  type DataTableColumn,
} from "@miragon/pulse-ui"
import { Maximize2 } from "lucide-react"
import { useInlineBudget, useRowsBudgeted } from "./inline-budget.js"
import { useInlineRows } from "./inline-fit.js"
import { kitLabels } from "./kit-labels.js"

/** The table's surface (pulse-ui's `--table-surface`, the card by default), which a pinned cell paints. */
const SURFACE = "var(--table-surface, var(--card))"

/** Container-query widths of the region itself; `md` hides in a 760 px inline view, shows in fullscreen. */
export const COLUMN_BREAKPOINTS = { sm: "40rem", md: "48rem", lg: "64rem" } as const

type ColumnBreakpoint = keyof typeof COLUMN_BREAKPOINTS

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
   * then paint the table's surface, the card; another surface sets `--table-surface`. A
   * breakpoint pins it only from that region width up: below it the column scrolls with the
   * rest, so a narrow region keeps the cells beside it in view, and its head's word is there for
   * a screen reader only, never a cut word at the region's edge.
   */
  sticky?: boolean | ColumnBreakpoint
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

/** Visually hidden, still read: the rules of Tailwind's `sr-only`. */
const SR_ONLY =
  "position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border-width: 0;"

/** Marks the head word of a column that scrolls with its row below its pinning breakpoint. */
const SCROLLING_HEAD = "data-list-table-scrolls"

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
      // The pinned cell inherits its row's background (hover, selection). The rows' surface sits in
      // the `components` layer: unlayered it would beat every utility, a row's hover fill (in
      // `utilities`) included, whatever the specificity.
      const pinned = cells.map(
        (cell) => `${cell} { position: sticky; right: 0; z-index: 1; background-color: inherit; }`,
      )
      rules.push(
        `@layer components { :where(${at} tbody tr), :where(${at} thead tr) { background-color: ${SURFACE}; } }`,
        ...(column.sticky === true ? pinned : pinnedFrom(at, column.sticky, pinned)),
      )
    }
  })
  return rules.join("\n")
}

/** Pinned from `from` up; below it the column scrolls and its head's word is for a screen reader. */
function pinnedFrom(at: string, from: ColumnBreakpoint, pinned: string[]): string[] {
  const width = COLUMN_BREAKPOINTS[from]
  return [
    `@container (min-width: ${width}) { ${pinned.join(" ")} }`,
    `@container (width < ${width}) { ${at} thead [${SCROLLING_HEAD}] { ${SR_ONLY} } }`,
  ]
}

/** A head that scrolls with its row below a breakpoint carries its word in a marked span. */
function headLabel(column: ListTableColumn): ReactNode {
  const scrolls = typeof column.sticky === "string" && column.label !== undefined
  return scrolls ? <span data-list-table-scrolls="">{column.label}</span> : column.label
}

/** Heads use `scope="col"`: `colgroup` would need `<col>` elements, which keep hidden columns in the table model. */
function GroupRow({ groups }: { groups: ReadonlyArray<ListTableGroup> }) {
  return (
    <tr data-list-table-groups="">
      {groups.map((group, index) =>
        group.label === undefined ? (
          <td
            key={index}
            colSpan={group.span ?? 1}
            className="bg-[var(--table-surface,var(--card))]"
          />
        ) : (
          <th
            key={index}
            scope="col"
            colSpan={group.span ?? 1}
            className={cn(
              "border-border text-foreground h-row px-cell border-l bg-[var(--table-surface,var(--card))] py-0 text-center align-bottom",
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
 * The MCP views' table: pulse-ui's `DataTable` (the named scroll region, the sticky head, the
 * compact rows, ids in one line) with the columns a narrow region drops (`hideBelow`), a pinned
 * action column, heads over groups of columns, and the inline fit: inside `PagedRows` it hands
 * its body to the paged fit instead of capping twice. Rows stay hand-composed per widget, since
 * cells differ; the rules address cell positions. Its columns fit their content and are not
 * sized: it hands `DataTable` no `sizing`, so no head has a grip or a column menu.
 */
export function ListTable({
  columns,
  groups,
  ariaLabel,
  wrapHeads,
  className,
  children,
}: {
  columns: ReadonlyArray<ListTableColumn>
  /** Heads over adjacent columns, in a row above the column heads ({@link ListTableGroup}). */
  groups?: ReadonlyArray<ListTableGroup>
  ariaLabel: string
  /**
   * Lets a long caption wrap where the region is short of room, so a wide table of figures keeps
   * every column in view (pulse-ui's `DataTable` `wrapHeads`); by default a caption keeps one line.
   */
  wrapHeads?: boolean
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
  const heads = columns.map((column, index): DataTableColumn => ({
    key: String(index),
    label: headLabel(column),
    align: column.align,
    plain: column.plain,
    sort: column.sort,
    className: column.className,
  }))
  return (
    <div data-list-table={scope} className="w-full min-w-0">
      {css && <style>{css}</style>}
      <DataTable
        label={ariaLabel}
        columns={heads}
        headRows={groups && <GroupRow groups={groups} />}
        wrapHeads={wrapHeads}
        bodyRef={paged ? paged.attachRows : own.attachRows}
        tableClassName={className}
        foot={
          capped && (
            <MoreRows
              colSpan={columns.length}
              shown={cap}
              total={rows.length}
              fullscreen={budget.expand !== null}
              onShowMore={showMore}
            />
          )
        }
      >
        {/* Same keyed rows either way, so a changing cap never remounts them. */}
        {capped ? rows.slice(0, cap) : rows}
      </DataTable>
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
        <td colSpan={colSpan} style={{ display: "table-cell" }} className="px-cell py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-small" aria-live="polite">
              {labels.rowsShown({ shown: formatNumber(shown), total: formatNumber(total) })}
            </span>
            <Button type="button" variant="outline" size="sm" onClick={onShowMore}>
              {fullscreen && <Icon icon={Maximize2} />}
              {fullscreen ? labels.showAll : labels.showMore}
            </Button>
          </div>
        </td>
      </tr>
    </tfoot>
  )
}
