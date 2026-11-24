import { useLayoutEffect } from "react"
import { CircleX } from "lucide-react"
import { cn, formatCompactCount, Icon } from "../index.js"
import { injectBpmnOverlayCss } from "./bpmn-tokens.js"
import type { DiagramCountKind } from "./diagram-marks.js"

/**
 * The class of each count's badge (`BPMN_OVERLAY_CSS`): running instances on the info ramp, root
 * incidents filled in the incident's colour (the named deviation of a number in a tone, on the
 * diagram alone), the incidents in called instances quiet, on the paper with the incident's
 * colour in their edge and their icon, since they are never part of the incident count.
 */
const BADGE_CLASS: Readonly<Record<DiagramCountKind, string>> = {
  running: "bpmn-overlay-badge--instance-count",
  incidents: "bpmn-overlay-badge--incident-count",
  incidentsInCalledInstances: "bpmn-overlay-badge--called-incident-count",
}

/** The props of a count's badge; the blocks' `CountBadgeProps` has this shape. */
export interface CanvasBadgeProps {
  readonly kind: DiagramCountKind
  /** None in a legend's sample. */
  readonly count?: number
  /** The counts are older than what the page shows beside them (a refresh runs): neutral. */
  readonly stale?: boolean
  /** A legend's sample, not a count on the diagram: smaller. */
  readonly legend?: boolean
}

/**
 * A count's badge on the BPMN canvas: a pill, its count compact, the incidents in called instances
 * with the incident's icon at the overlays' 12 px beside it; neutral while stale, a legend's
 * sample without a count. A drawing (`aria-hidden`): what names it is the count's button or the
 * page's words. It brings the canvas's stylesheet, so a legend draws it where no diagram mounted;
 * as the blocks' `Badge` slot it is the surface's badge of the shared screens.
 */
export function CanvasBadge({ kind, count, stale = false, legend = false }: CanvasBadgeProps) {
  useLayoutEffect(() => {
    injectBpmnOverlayCss()
  }, [])
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
