import { createContext, useContext, type ReactNode } from "react"
import { shortId } from "../format/text.js"
import { cn } from "../lib/utils.js"
import { BreakableId } from "./id-breaks.js"

/**
 * How a `NamedId` lays out: `stacked` (the name, the id a quiet line below, wrapping between its
 * parts) or `inline` (one line). A `DataTable`'s body provides `inline`, so an id in a table cell
 * keeps its row at the row height; everywhere else it is `stacked`.
 */
export type NamedIdLayout = "stacked" | "inline"

export const NamedIdLayoutContext = createContext<NamedIdLayout>("stacked")

interface NamedIdParts {
  shown: string | null
  id: string
  lead?: ReactNode
  facts: ReactNode[]
  className?: string
}

/** The words of the facts that are words, for the title: an element has none to give. */
function textOf(facts: ReactNode[]): string[] {
  return facts.flatMap((part) =>
    typeof part === "string" || typeof part === "number" ? [String(part)] : [],
  )
}

/**
 * The one line's track: as wide as its text where there is room, down to `--named-id-floor` (8rem
 * by default) where the column is short of it. A table cell's layout reads that floor as the
 * line's narrowest, so the column holding it gives way first and the other columns keep their
 * one-line content; a `DataTable` sets it to the whole text where a column fits its content and to
 * nothing once its columns are sized.
 */
const INLINE_TRACK = "grid min-w-0 grid-cols-[minmax(var(--named-id-floor,8rem),max-content)]"

/**
 * One line: the name, then the id short (`shortId`) in mono and quiet, then the details, cut with
 * an ellipsis where the cell ends. The whole text is in the title on hover, and the whole id is
 * what a screen reader reads.
 */
function InlineNamedId({ shown, id, lead, facts, className }: NamedIdParts) {
  const short = shortId(id)
  const title = [shown, id, ...textOf(facts)].filter(Boolean).join(" · ")
  return (
    <span data-named-id="inline" className={cn("flex min-w-0 items-center gap-2", className)}>
      {lead}
      <span className={INLINE_TRACK}>
        <span className="text-dense min-w-0 truncate" title={title}>
          {shown && <span className="text-foreground">{shown} </span>}
          <span className={cn("font-mono", shown ? "text-muted-foreground" : "text-foreground")}>
            {short === id ? (
              id
            ) : (
              <>
                <span aria-hidden="true">{short}</span>
                <span className="sr-only">{id}</span>
              </>
            )}
          </span>
          {facts.map((part, index) => (
            <span key={index} className="text-muted-foreground">
              {" · "}
              {part}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}

/** Two lines: the name first, the id a quiet mono line below, wrapping between its parts. */
function StackedNamedId({ shown, id, lead, facts, className }: NamedIdParts) {
  return (
    <span data-named-id="stacked" className={cn("flex min-w-0 flex-col", className)}>
      <span className="text-foreground text-dense flex min-w-0 items-center gap-2 font-semibold">
        {lead}
        <span className={cn(shown ? "break-words" : "font-mono wrap-anywhere")}>
          {shown ?? <BreakableId id={id} />}
        </span>
      </span>
      {(shown || facts.length > 0) && (
        <span className="text-muted-foreground text-small break-words">
          {shown && (
            <span className="font-mono wrap-anywhere">
              <BreakableId id={id} />
            </span>
          )}
          {facts.map((part, index) => (
            <span key={index}>
              {(shown || index > 0) && " · "}
              {part}
            </span>
          ))}
        </span>
      )}
    </span>
  )
}

/**
 * A process's or an element's name with its id, the same look in every module. Without a real
 * name the id leads once, in mono, so it never reads as a name. In a table cell (a `DataTable`'s
 * body) it takes one line (`layout="inline"`), so the row keeps its height; outside tables (a
 * detail's facts, a header) it stacks, and a long id wraps between its parts (`BreakableId`) so it
 * never widens what holds it. `layout` overrides where it sits.
 */
export function NamedId({
  name,
  id,
  lead,
  detail,
  layout,
  className,
}: {
  name: string | null | undefined
  id: string
  lead?: ReactNode
  detail?: ReadonlyArray<ReactNode>
  layout?: NamedIdLayout
  className?: string
}) {
  const inherited = useContext(NamedIdLayoutContext)
  const parts: NamedIdParts = {
    shown: name && name !== id ? name : null,
    id,
    lead,
    facts: (detail ?? []).filter((part) => part !== null && part !== undefined && part !== ""),
    className,
  }
  return (layout ?? inherited) === "inline" ? (
    <InlineNamedId {...parts} />
  ) : (
    <StackedNamedId {...parts} />
  )
}
