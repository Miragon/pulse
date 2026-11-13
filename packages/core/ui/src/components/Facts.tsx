import { Fragment, type ReactNode } from "react"
import { cn } from "../lib/utils.js"

/** One fact of a {@link Facts} list. */
export interface Fact {
  /** What the value is ("Root cause", "Job"), the term. */
  label: ReactNode
  /** The value: text, a `CopyableId`, a link. */
  value: ReactNode
  /** A technical value (a code, an exception, an expression): monospace. */
  mono?: boolean
  /** The value the eye goes to first (a root cause): at 600. */
  emphasis?: boolean
  /** A stable React key; default: the label's text, else its place. */
  id?: string
}

export interface FactsProps {
  facts: readonly Fact[]
  className?: string
}

/**
 * Facts about one thing (the webview's incident facts) as a description list on a two-column
 * grid: each term quiet in 13 px, its value in the foreground beside it. A value wraps anywhere
 * rather than widen the view (an exception, a long id), several parts of one value wrap as a row
 * 4 px apart, and a `CopyableId` in it shows its copy button always.
 */
export function Facts({ facts, className }: FactsProps) {
  return (
    <dl
      data-slot="facts"
      className={cn(
        "text-dense grid w-full grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1",
        className,
      )}
    >
      {facts.map((fact, index) => (
        <Fragment key={fact.id ?? (typeof fact.label === "string" ? fact.label : index)}>
          <dt className="text-small text-muted-foreground">{fact.label}</dt>
          <dd
            className={cn(
              "text-foreground flex min-w-0 flex-wrap items-center gap-1 [overflow-wrap:anywhere]",
              fact.mono && "font-mono",
              fact.emphasis && "font-semibold",
            )}
          >
            {fact.value}
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}
