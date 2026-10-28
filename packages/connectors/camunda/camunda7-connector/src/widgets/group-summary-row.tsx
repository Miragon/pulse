import type { ReactNode } from "react"
import { Icon } from "@miragon/pulse-widget-shell/widgets"
import { ChevronRight, TriangleAlert } from "lucide-react"
import { cn, CountPill, TONE_DOT, type ToneVariant } from "@miragon/mcp-toolkit-ui"

export interface GroupSummaryStat {
  value: ReactNode
  label: ReactNode
}

/** Shared so the grouped incident lists stay pixel-identical; decorative, the row names the activity. */
export function IncidentGroupIcon({ tone = "danger" }: { tone?: ToneVariant }) {
  return (
    <div
      className={cn(
        "grid size-6 place-items-center rounded-md",
        tone === "danger" ? "bg-danger-soft text-danger-ink" : "bg-muted text-muted-foreground",
      )}
    >
      <Icon icon={TriangleAlert} dense />
    </div>
  )
}

/** Shared summary-row anatomy; `expanded` doubles as the expandability switch (omit for plain rows). */
export function GroupSummaryRow({
  icon,
  tone,
  title,
  titleSuffix,
  subline,
  stats = [],
  count,
  countTone = "danger",
  actions,
  expanded,
  className,
}: {
  icon?: ReactNode
  tone?: ToneVariant
  title: ReactNode
  /** Inline suffix after the title, e.g. a `VersionChip`. */
  titleSuffix?: ReactNode
  /** Truncated second line under the title (the cause, in words). */
  subline?: ReactNode
  stats?: GroupSummaryStat[]
  /** Count-pill content after the stats; omit to render no pill. */
  count?: ReactNode
  countTone?: ToneVariant
  /** Action cells (AskAi / drill / cockpit link) between the pill and the chevron. */
  actions?: ReactNode
  expanded?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 px-4 py-3",
        expanded && "border-border border-b",
        className,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-dense flex items-center gap-2 font-semibold">
          {tone && (
            <span
              aria-hidden="true"
              className={`size-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`}
            />
          )}
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
      {count !== undefined && <CountPill tone={countTone}>{count}</CountPill>}
      {actions}
      {expanded !== undefined && (
        <Icon
          icon={ChevronRight}
          dense
          className={`text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
        />
      )}
    </div>
  )
}
