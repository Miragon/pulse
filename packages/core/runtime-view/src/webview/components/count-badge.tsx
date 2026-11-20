import { CircleXIcon } from "lucide-react"
import type { CountBadgeProps as BadgeSlotProps } from "@miragon/pulse-blocks"
import { cn, Icon } from "@miragon/pulse-ui"
import { CountLabels } from "../format/count-labels.js"

type CountBadgeVariant = "incident" | "propagated" | "running"

export interface CountBadgeProps {
  readonly variant: CountBadgeVariant
  readonly count?: number
  readonly stale?: boolean
  readonly legend?: boolean
}

const VARIANTS: Readonly<Record<BadgeSlotProps["kind"], CountBadgeVariant>> = {
  incidents: "incident",
  incidentsInCalledInstances: "propagated",
  running: "running",
}

export function CountBadge({ variant, count, stale = false, legend = false }: CountBadgeProps) {
  const withIcon = variant !== "running"
  return (
    <span
      className={cn(
        "count-badge",
        `count-badge--${variant}`,
        stale && "count-badge--stale",
        legend && "count-badge--legend",
      )}
      data-part="count-badge"
      data-variant={variant}
      data-state={stale ? "stale" : undefined}
    >
      {withIcon && <Icon icon={CircleXIcon} dense />}
      {count !== undefined && (
        <span className="count-badge__count">{CountLabels.compact(count)}</span>
      )}
    </span>
  )
}

export function DiagramBadge({ kind, count, stale, legend }: BadgeSlotProps) {
  return (
    <CountBadge
      variant={VARIANTS[kind]}
      {...(count === undefined ? {} : { count })}
      {...(stale === undefined ? {} : { stale })}
      {...(legend === undefined ? {} : { legend })}
    />
  )
}
