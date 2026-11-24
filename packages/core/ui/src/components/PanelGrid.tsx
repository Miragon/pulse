import { useId, type ReactNode } from "react"
import type { SectionHeadingLevel } from "../kit/section.js"
import { cn } from "../lib/utils.js"
import { SectionHeading } from "./SectionHeading.js"

export interface PanelGridProps {
  /**
   * How many panels stand side by side where the grid has the room: 2 (default) from 600 px of
   * its own width, 3 from 900 px (2 between); below 600 px always one.
   */
  readonly columns?: 1 | 2 | 3
  /** The panels (`Panel`), one per section. */
  readonly children: ReactNode
  readonly className?: string
}

/** The columns per setting, by the grid's own width (its container), never the window's. */
const COLUMNS: Readonly<Record<NonNullable<PanelGridProps["columns"]>, string>> = {
  1: "",
  2: "@min-[37.5rem]/panels:grid-cols-2",
  3: "@min-[37.5rem]/panels:grid-cols-2 @min-[56.25rem]/panels:grid-cols-3",
}

/**
 * A dashboard's rows of panels: one column below 600 px of the grid's own width (a phone, a
 * narrow host), `columns` side by side where it has the room, the panels of a row as tall as the
 * tallest, so their ends line up. The gap is the density's section gap (12 px, 16 px on touch).
 * Columns follow the grid's own width, so a grid inside a narrow frame stacks as on a phone.
 */
export function PanelGrid({ columns = 2, children, className }: PanelGridProps) {
  return (
    <div data-slot="panel-grid" className={cn("@container/panels min-w-0", className)}>
      <div className={cn("gap-section grid grid-cols-1", COLUMNS[columns])}>{children}</div>
    </div>
  )
}

export interface PanelProps {
  /** The section's title. */
  readonly title: ReactNode
  /** The title's element. Default `"h2"`: a section of the page under its `h1`. */
  readonly as?: SectionHeadingLevel
  /** The quiet note beside the title: the scope its numbers span ("all versions"). */
  readonly hint?: ReactNode
  /** A control at the title's end (a legend, a switch), after the hint. */
  readonly trailing?: ReactNode
  /** The section's id: an anchor to scroll to, and a place the page can move the focus to. */
  readonly id?: string
  /** Spans the whole row of its `PanelGrid` (a diagram, a wide table). */
  readonly wide?: boolean
  readonly className?: string
  readonly children: ReactNode
}

/**
 * One section of a dashboard: a card of the compact look (the card's surface, a 1 px line, the
 * md radius, the density's gutter inside) named by its `SectionHeading`, its content below. A
 * `section` labelled by its title, so it is a landmark a screen reader lists; with an `id` it
 * takes the focus a page moves to it.
 */
export function Panel({
  title,
  as = "h2",
  hint,
  trailing,
  id,
  wide = false,
  className,
  children,
}: PanelProps) {
  const headingId = useId()
  return (
    <section
      id={id}
      tabIndex={id === undefined ? undefined : -1}
      aria-labelledby={headingId}
      data-slot="panel"
      className={cn(
        "bg-card text-card-foreground border-border text-dense p-gutter flex min-w-0 flex-col rounded-md border",
        wide && "col-span-full",
        className,
      )}
    >
      <SectionHeading
        as={as}
        id={headingId}
        title={title}
        hint={trailing === undefined ? hint : undefined}
        trailing={
          trailing === undefined ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              {hint}
              {trailing}
            </span>
          )
        }
      />
      {children}
    </section>
  )
}
