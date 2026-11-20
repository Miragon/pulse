import type { CountBadgeProps } from "@miragon/pulse-blocks"
import { cn, formatCompactCount, Icon } from "@miragon/pulse-ui"
import { CircleX } from "lucide-react"

/**
 * The class of each count's badge on the page's canvas: the canvas's own two (`BPMN_OVERLAY_CSS`:
 * running instances on the info ramp, root incidents filled in the incident's colour, the named
 * deviation of a number in a tone) and the page's own for incidents in called instances
 * (`src/styles.css`): quiet, the incident's colour only in its edge and its icon, since it is never
 * part of the incident count.
 */
const BADGE_CLASS: Readonly<Record<CountBadgeProps["kind"], string>> = {
  running: "bpmn-overlay-badge--instance-count",
  incidents: "bpmn-overlay-badge--incident-count",
  incidentsInCalledInstances: "pulse-badge-called",
}

/**
 * The page's count badge on its BPMN canvas (the blocks' `Badge` slot): a pill on the paper of the
 * canvas that follows the theme, its count compact, the incidents in called instances with the
 * incident's icon at the overlays' 12 px beside it; quiet while the counts are older than the list
 * under them (`stale`), a legend's sample without a count. The block names it; the badge is a
 * drawing (`aria-hidden`).
 */
export function CanvasBadge({ kind, count, stale = false, legend = false }: CountBadgeProps) {
  return (
    <span
      aria-hidden="true"
      data-part="canvas-badge"
      data-kind={kind}
      className={cn(
        "bpmn-overlay-badge",
        BADGE_CLASS[kind],
        stale && "pulse-badge-stale",
        legend && "pulse-badge-legend",
      )}
    >
      {kind === "incidentsInCalledInstances" && <Icon icon={CircleX} dense />}
      {count !== undefined && formatCompactCount(count)}
    </span>
  )
}
