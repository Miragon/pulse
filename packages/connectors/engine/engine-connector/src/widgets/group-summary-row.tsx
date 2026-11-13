import type { ReactNode } from "react"
import { CountBadge, Icon, cn, formatNumber } from "@miragon/pulse-ui"
import { ChevronRight } from "lucide-react"
import { useT } from "../messages/use-t.js"

export interface GroupSummaryStat {
  value: ReactNode
  label: ReactNode
}

/**
 * Shared summary-row anatomy, so the grouped incident lists stay pixel-identical; `expanded`
 * doubles as the expandability switch (omit for plain rows). The row's one alarm sign is its
 * incident count's pill, the tone's icon of its own shape: no second icon leads the row.
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
      className={cn(
        "px-cell flex items-center gap-4 py-2",
        expanded && "border-border border-b",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-dense flex items-center gap-2 font-semibold">
          <span className="truncate">{title}</span>
          {titleSuffix}
        </div>
        {/* The cause in words (an engine message), not code: no mono. */}
        {subline !== undefined && (
          <div className="text-muted-foreground text-small truncate">{subline}</div>
        )}
      </div>
      {stats.map((stat, i) => (
        <div
          key={i}
          className="text-muted-foreground text-small min-w-[80px] text-right tabular-nums"
        >
          <div className="text-foreground font-semibold">{stat.value}</div>
          <div>{stat.label}</div>
        </div>
      ))}
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
  )
}
