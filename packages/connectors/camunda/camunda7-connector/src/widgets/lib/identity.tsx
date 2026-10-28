import { cn } from "@miragon/mcp-toolkit-ui"
import { IdText } from "@miragon/pulse-widget-shell/widgets"

/** #322 U13: names before ids; ids are the quiet second line. */

/** Matches `instanceName`, which toasts and confirmations use. */
export function InstanceLabel({
  id,
  businessKey,
  className,
}: {
  id: string
  businessKey: string | null | undefined
  className?: string
}) {
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-2", className)}>
      {businessKey && <span className="text-foreground font-semibold">{businessKey}</span>}
      <IdText value={id} className="text-muted-foreground" />
    </span>
  )
}

/** Null for a bare generated id; the widget twin of the data layer's parse, which the bundle doesn't import. */
export function definitionVersionOf(definitionId: string | null | undefined): number | null {
  const segment = definitionId?.split(":")[1]
  return segment && /^\d+$/.test(segment) ? Number(segment) : null
}
