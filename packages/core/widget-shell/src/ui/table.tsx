import type { ReactNode } from "react"
import { cn, EmptyState, MICRO_LABEL, type StateHeadingLevel } from "@miragon/mcp-toolkit-ui"
import { ArrowDown, ArrowUp, CircleCheck, Inbox } from "lucide-react"
import { Icon } from "./icon.js"

export type ColumnSort = "ascending" | "descending"

const TH_LABEL = `border-border text-muted-foreground border-y px-4 py-2.5 ${MICRO_LABEL}`

export function Th({
  align = "left",
  plain = false,
  sort,
  className,
  children,
}: {
  align?: "left" | "right"
  /** Bare header cell (e.g. the empty action column) — border/padding only. */
  plain?: boolean
  sort?: ColumnSort
  className?: string
  children?: ReactNode
}) {
  const base = plain
    ? "border-border border-y px-4 py-2.5"
    : `${TH_LABEL} ${align === "right" ? "text-right" : "text-left"}`
  return (
    <th scope="col" aria-sort={sort} className={cn(base, className)}>
      {sort ? (
        <span
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap",
            align === "right" && "flex-row-reverse",
          )}
        >
          {children}
          <Icon icon={sort === "descending" ? ArrowDown : ArrowUp} dense />
        </span>
      ) : (
        children
      )}
    </th>
  )
}

export function Td({
  align = "left",
  className,
  children,
}: {
  align?: "left" | "right"
  className?: string
  children?: ReactNode
}) {
  return (
    <td
      className={cn(
        "border-border text-dense border-b px-4 py-3 align-middle",
        align === "right" && "text-right",
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
        icon={icon ?? <Glyph strokeWidth={2.5} />}
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
        "border-border bg-muted text-muted-foreground text-small ml-2 inline-block rounded-sm border px-2 py-0.5 align-middle font-mono font-medium",
        className,
      )}
    >
      v{version}
    </span>
  )
}
