import type { ReactNode } from "react"
import { CountBadge, Icon, cn, formatNumber } from "@miragon/pulse-ui"
import { ChevronRight } from "lucide-react"
import { useT } from "../messages/use-t.js"

export interface GroupSummaryStat {
  value: ReactNode
  label: ReactNode
}

/**
 * Under this width of the row (42rem) its stats move onto a line of their own under the title,
 * each its label then its value, so the title keeps its share beside the count and the chevron.
 */
const NARROW = {
  stats:
    "@max-2xl/summary:order-last @max-2xl/summary:basis-full @max-2xl/summary:flex-wrap @max-2xl/summary:gap-x-3 @max-2xl/summary:gap-y-0",
  stat: "@max-2xl/summary:min-w-0 @max-2xl/summary:flex-row-reverse @max-2xl/summary:justify-end @max-2xl/summary:gap-1 @max-2xl/summary:text-left",
} as const

/**
 * Shared summary-row anatomy, so the grouped incident lists stay pixel-identical; `expanded`
 * doubles as the expandability switch (omit for plain rows). The row's one alarm sign is its
 * incident count's pill, the tone's icon of its own shape: no second icon leads the row. On the
 * density roles: a list entry's height at least, the cell's padding. The title keeps 10rem at
 * least; in a narrow row (a phone-width chat) the stats sit under it.
 */
export function GroupSummaryRow({
  title,
  titleSuffix,
  subline,
  stats = [],
  incidents,
  actions,
  expanded,
  className,
}: {
  title: ReactNode
  /** Inline suffix after the title, e.g. a `VersionChip`. */
  titleSuffix?: ReactNode
  /** Truncated second line under the title (the cause, in words). */
  subline?: ReactNode
  stats?: GroupSummaryStat[]
  /**
   * The group's open incidents after the stats: a neutral count pill with the incident's icon,
   * the count in words for a screen reader, never a coloured number; omit to render none.
   */
  incidents?: number
  /** Action cells (AskAi / drill / cockpit link) between the pill and the chevron. */
  actions?: ReactNode
  expanded?: boolean
  className?: string
}) {
  const t = useT()
  return (
    <div
      data-slot="group-summary"
      className={cn("@container/summary", expanded && "border-border border-b", className)}
    >
      <div className="px-cell py-cell min-h-entry flex flex-wrap items-center gap-x-4 gap-y-1">
        <div data-slot="group-summary-title" className="min-w-[min(10rem,100%)] flex-1">
          <div className="text-foreground text-dense flex items-center gap-2 font-semibold">
            <span className="truncate">{title}</span>
            {titleSuffix}
          </div>
          {/* The cause in words (an engine message), not code: no mono. */}
          {subline !== undefined && (
            <div className="text-muted-foreground text-small truncate">{subline}</div>
          )}
        </div>
        {stats.length > 0 && (
          <div data-slot="group-summary-stats" className={cn("flex gap-4", NARROW.stats)}>
            {stats.map((stat, i) => (
              <div
                key={i}
                className={cn(
                  "text-muted-foreground text-small flex min-w-[80px] flex-col text-right tabular-nums",
                  NARROW.stat,
                )}
              >
                <div className="text-foreground font-semibold whitespace-nowrap">{stat.value}</div>
                <div>{stat.label}</div>
              </div>
            ))}
          </div>
        )}
        {incidents !== undefined && (
          <CountBadge
            count={incidents}
            situation={incidents > 0 ? "openIncident" : undefined}
            label={t("procIncHeader.openIncidents", { count: formatNumber(incidents) })}
          />
        )}
        {actions}
        {expanded !== undefined && (
          <Icon
            icon={ChevronRight}
            className={`text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </div>
    </div>
  )
}
