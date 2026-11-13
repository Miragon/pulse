import type { ReactNode } from "react"
import { cn } from "../lib/utils.js"
import { EmptyState, type StateHeadingLevel } from "../components/EmptyState.js"
import { MICRO_LABEL } from "../lib/typography.js"
import { ArrowDown, ArrowUp, CircleCheck, Inbox } from "lucide-react"
import { Icon, ICON_STROKE } from "./icon.js"

export type ColumnSort = "ascending" | "descending"

/**
 * A head cell on the row height (28 px compact, 40 px on touch) with the cell's side padding,
 * the 13 px caption at 600 in the quiet ink on one line and one rule below. It paints the table's
 * surface (`--table-surface`, the card by default), so a sticky head covers the rows scrolling
 * under it. A caption keeps its line: where the columns need more room than the region shows, a
 * `NamedId`'s line gives way first, then the table scrolls inside its region (a `DataTable` with
 * `wrapHeads` lets its captions wrap instead).
 */
const TH_CELL =
  "border-border h-row px-cell border-b bg-[var(--table-surface,var(--card))] py-0 align-middle whitespace-nowrap"

/** A head cell's classes: the caption, aligned, or a bare one (the row actions' head). */
export function thClasses(align: "left" | "right", plain: boolean): string {
  if (plain) return TH_CELL
  return cn(
    TH_CELL,
    "text-muted-foreground",
    MICRO_LABEL,
    align === "right" ? "text-right" : "text-left",
  )
}

/** A head's caption with the arrow of its sort, which stays on the cell's own side. */
export function SortLabel({
  sort,
  align,
  children,
}: {
  sort: ColumnSort
  align: "left" | "right"
  children?: ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap",
        align === "right" && "flex-row-reverse",
      )}
    >
      {children}
      <Icon icon={sort === "descending" ? ArrowDown : ArrowUp} dense />
    </span>
  )
}

export function Th({
  align = "left",
  plain = false,
  sort,
  className,
  children,
}: {
  align?: "left" | "right"
  /** Bare header cell (e.g. the empty action column): the rule and padding only. */
  plain?: boolean
  sort?: ColumnSort
  className?: string
  children?: ReactNode
}) {
  return (
    <th scope="col" aria-sort={sort} className={cn(thClasses(align, plain), className)}>
      {sort ? (
        <SortLabel sort={sort} align={align}>
          {children}
        </SortLabel>
      ) : (
        children
      )}
    </th>
  )
}

/**
 * A body cell's padding above and below: the cell's padding (`--cell-py`), at most half of what a
 * 24 px control (`--control-h-xs`) and the 1 px rule below leave of the row height (1.5 px
 * compact, 3.5 px comfortable). A line of 13 px text (19.5 px), a 20 px pill or a table row's xs
 * actions (24 px, 32 px comfortable), the padding and the rule then stay inside the row height,
 * so a one-line row is exactly the row height, its actions included; a control in a cell that
 * reaches into the padding (`IdText`'s copy button) adds nothing either. A wrapped cell keeps the
 * padding.
 */
const TD_PADDING_Y = "py-[min(var(--cell-py),calc((var(--row-h)_-_var(--control-h-xs)_-_1px)/2))]"

/**
 * A body cell: the row height as a minimum (so text at 200 % still wraps into a taller row), the
 * cell's padding, 13 px text and one rule below. `truncate` keeps it to one line with an
 * ellipsis once its column is narrower than the text (a sized column of a `DataTable`, a cell
 * given a width), the full text in its `title` (by default the text itself) and whole for a
 * screen reader, which reads the cell, not what shows.
 */
export function Td({
  align = "left",
  truncate = false,
  title,
  colSpan,
  className,
  children,
}: {
  align?: "left" | "right"
  truncate?: boolean
  /** The full text on hover; a `truncate` cell of plain text takes the text by default. */
  title?: string
  colSpan?: number
  className?: string
  children?: ReactNode
}) {
  const fullText = title ?? (truncate && typeof children === "string" ? children : undefined)
  return (
    <td
      title={fullText}
      colSpan={colSpan}
      className={cn(
        "border-border text-dense h-row px-cell border-b align-middle",
        TD_PADDING_Y,
        align === "right" && "text-right",
        truncate && "truncate",
        className,
      )}
    >
      {children}
    </td>
  )
}

/** `done` uses the success tone, so "all clear" never reads like missing data. */
export type EmptyVariant = "empty" | "done"

const EMPTY_ICON = {
  empty: { icon: Inbox, tone: "neutral" },
  done: { icon: CircleCheck, tone: "success" },
} as const

export function TableEmptyState({
  children,
  variant = "empty",
  description,
  action,
  secondaryAction,
  icon,
  titleAs = "p",
  className,
}: {
  /** What is empty, in plain words ("No open incidents"). */
  children: ReactNode
  variant?: EmptyVariant
  /** One help line: why it is empty, or what to do next. */
  description?: ReactNode
  action?: ReactNode
  secondaryAction?: ReactNode
  /** A Lucide icon for the concrete situation (e.g. `<SearchX />` for no matches). */
  icon?: ReactNode
  /** Default `"p"`: it stands in for a table, not a section. */
  titleAs?: StateHeadingLevel
  className?: string
}) {
  const { icon: Glyph, tone } = EMPTY_ICON[variant]
  return (
    <div
      data-empty-variant={variant}
      className={cn("border-border bg-card rounded-md border", className)}
    >
      <EmptyState
        icon={icon ?? <Glyph strokeWidth={ICON_STROKE} />}
        tone={tone}
        title={children}
        description={description}
        action={action}
        secondaryAction={secondaryAction}
        titleAs={titleAs}
      />
    </div>
  )
}

/**
 * A version as a quiet chip ("v3"): mono caption text on the ground with a line edge, the badge's
 * 20 px height, so it sits in a 28 px table row as in a view's bar.
 */
export function VersionChip({
  version,
  className,
}: {
  version: number | string
  className?: string
}) {
  return (
    <span
      className={cn(
        "border-border bg-muted text-muted-foreground text-small min-h-badge ml-2 inline-flex items-center rounded-sm border px-2 align-middle font-mono leading-4",
        className,
      )}
    >
      v{version}
    </span>
  )
}
