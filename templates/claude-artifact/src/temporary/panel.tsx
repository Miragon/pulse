// Replaced by @miragon/pulse-ui's PanelGrid once Miragon/pulse#664 lands.
import { useId, type ReactNode } from "react"
import { cn, SectionHeading } from "@miragon/pulse-ui"

/**
 * A dashboard's rows: one column on a phone, `columns` side by side from 64rem, each panel as tall
 * as its row.
 */
export function PanelGrid({
  columns = 2,
  children,
}: {
  readonly columns?: 1 | 2
  readonly children: ReactNode
}) {
  return (
    <div className={cn("grid min-w-0 gap-4", columns === 2 && "lg:grid-cols-2")}>{children}</div>
  )
}

export interface PanelProps {
  /** The section's id, an anchor to scroll to and to move the focus to. */
  readonly id?: string
  readonly title: ReactNode
  /** The quiet note beside the title: the scope the numbers span ("all versions"). */
  readonly hint?: ReactNode
  /** A control at the title's end (a legend), instead of the hint's place. */
  readonly trailing?: ReactNode
  readonly children: ReactNode
  readonly className?: string
}

/** One section of a dashboard: a card with its h2 title, its scope and its content. */
export function Panel({ id: anchor, title, hint, trailing, children, className }: PanelProps) {
  const id = useId()
  return (
    <section
      id={anchor}
      tabIndex={anchor === undefined ? undefined : -1}
      aria-labelledby={id}
      className={cn(
        "border-border bg-card text-card-foreground flex min-w-0 flex-col rounded-md border p-4",
        className,
      )}
    >
      <SectionHeading
        as="h2"
        id={id}
        title={title}
        hint={trailing === undefined ? hint : undefined}
        trailing={
          trailing === undefined ? undefined : (
            <span className="text-muted-foreground flex items-center gap-2">
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
