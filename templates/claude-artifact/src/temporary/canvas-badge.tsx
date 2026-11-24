// Replaced by the public BPMN diagram of @miragon/pulse-ui once Miragon/pulse#662 lands.
// A copy of the web app's apps/web/src/screens/process/canvas-badge.tsx.
import type { CountBadgeProps } from "@miragon/pulse-blocks"
import { cn, formatCompactCount, Icon } from "@miragon/pulse-ui"
import { CircleX } from "lucide-react"

/**
 * The class of each count's badge on the canvas: the canvas's own two (`BPMN_OVERLAY_CSS`: running
 * instances on the info ramp, root incidents filled in the incident's colour) and the page's own
 * for incidents in called instances (`diagram.css`): quiet, the incident's colour only in its edge
 * and its icon, since it is never part of the incident count.
 */
const BADGE_CLASS: Readonly<Record<CountBadgeProps["kind"], string>> = {
  running: "bpmn-overlay-badge--instance-count",
  incidents: "bpmn-overlay-badge--incident-count",
  incidentsInCalledInstances: "pulse-badge-called",
}

/**
 * The page's count badge on its BPMN canvas (the blocks' `Badge` slot): a pill on the canvas's
 * paper, its count compact, the incidents in called instances with the incident's icon at the
 * overlays' 12 px beside it; quiet while stale, a legend's sample without a count. The block names
 * it; the badge is a drawing (`aria-hidden`).
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
