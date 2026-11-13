import { cn } from "@miragon/pulse-ui"
import { IdText } from "@miragon/pulse-widget-shell/widgets"

/** #322 U13: names before ids; ids are the quiet second part. */

/**
 * The one line's track, as a `NamedId` takes it in a table cell: as wide as its text where there
 * is room, down to `--named-id-floor` (8rem by default) where the column is short of it.
 */
const LINE_TRACK = "grid min-w-0 grid-cols-[minmax(var(--named-id-floor,8rem),max-content)]"

/**
 * A table's subject column (an instance, an element) fits its content, as pulse-ui's `DataTable`
 * fits its drawn rows: the head takes `SUBJECT_COLUMN`, its cells `SUBJECT_CELL`. The subject is
 * whole while the region has room, so a name or a message column beside it gives way first; under
 * 28rem (a phone-width chat) it gives way down to the one line's floor (8rem), cut with an
 * ellipsis, and the table scrolls in its region.
 */
export const SUBJECT_COLUMN = "w-[1%]"
export const SUBJECT_CELL = "[--named-id-floor:max-content] @max-md:[--named-id-floor:8rem]"

/**
 * Matches `instanceName`, which toasts and confirmations use. In a table cell (the default) it is
 * one line, so the row keeps the row height (invariant 6): the business key, then the short id
 * quiet in mono with its copy button; where the column is short of room the key is cut with an
 * ellipsis, the whole in its title. In a region under 28rem (a phone-width chat) an instance with
 * a key shows the key alone, its id still in the title and read out. Without a key the short id
 * shows alone, whole. `wrap` is for a line of facts outside a table (a detail's header), where
 * the key and the id wrap between them, never cut.
 */
export function InstanceLabel({
  id,
  businessKey,
  wrap = false,
  className,
}: {
  id: string
  businessKey: string | null | undefined
  wrap?: boolean
  className?: string
}) {
  if (wrap) {
    return (
      <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-2", className)}>
        {businessKey && <span className="text-foreground font-semibold">{businessKey}</span>}
        <IdText value={id} className="text-muted-foreground" />
      </span>
    )
  }
  // Without a key the short id alone, never cut (12 characters at most): it needs no floor.
  if (!businessKey) {
    return <IdText value={id} className={cn("text-muted-foreground", className)} />
  }
  return (
    <span data-instance-label="" className={cn(LINE_TRACK, className)}>
      <span className="flex min-w-0 items-center gap-2">
        <span
          className="text-foreground min-w-0 truncate font-semibold"
          title={`${businessKey} · ${id}`}
        >
          {businessKey}
          <span className="sr-only @md:hidden">{` ${id}`}</span>
        </span>
        <IdText value={id} className="text-muted-foreground shrink-0 @max-md:hidden" />
      </span>
    </span>
  )
}

/** Null for a bare generated id; the widget twin of the data layer's parse, which the bundle doesn't import. */
export function definitionVersionOf(definitionId: string | null | undefined): number | null {
  const segment = definitionId?.split(":")[1]
  return segment && /^\d+$/.test(segment) ? Number(segment) : null
}
