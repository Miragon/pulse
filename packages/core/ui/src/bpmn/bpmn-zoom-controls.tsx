import { Scan, ZoomIn, ZoomOut } from "lucide-react"
import { cn, FOCUS_RING_INSET, Icon, useUiMessages } from "../index.js"
import { ZOOM_CONTROLS_SLOT } from "./bpmn-fit.js"

interface BpmnZoomControlsLabels {
  zoomIn?: string
  zoomOut?: string
  fit?: string
}

export interface BpmnZoomControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  labels?: BpmnZoomControlsLabels
  /** Merged over the default placement (e.g. `top-6 right-6` repositions). */
  className?: string
}

/**
 * Top-right, not bottom-right: bpmn-js pins its bpmn.io logo (licence requirement) there at z-index
 * 100, covering zoom-out. In the theme, as the canvas under it (a raised card on its paper).
 * Placed beside the viewer's container in one frame, as `useBpmnViewer` expects: its fit keeps the
 * diagram clear of the bar (and of the logo) wherever the bar lies.
 */
export function BpmnZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
  labels,
  className,
}: BpmnZoomControlsProps) {
  const defaults = useUiMessages().bpmn
  const buttons = [
    { key: "in", icon: ZoomIn, onClick: onZoomIn, title: labels?.zoomIn ?? defaults.zoomIn },
    { key: "fit", icon: Scan, onClick: onFit, title: labels?.fit ?? defaults.fit },
    { key: "out", icon: ZoomOut, onClick: onZoomOut, title: labels?.zoomOut ?? defaults.zoomOut },
  ]
  return (
    <div
      data-slot={ZOOM_CONTROLS_SLOT}
      className={cn(
        "border-border bg-card text-card-foreground shadow-1 absolute top-3 right-3 flex flex-col overflow-hidden rounded-md border",
        className,
      )}
    >
      {buttons.map(({ key, icon, onClick, title }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          title={title}
          aria-label={title}
          className={cn(
            "hover:bg-accent hover:text-accent-foreground active:bg-accent [&:not(:last-child)]:border-border flex size-8 items-center justify-center transition-colors [&:not(:last-child)]:border-b",
            FOCUS_RING_INSET,
          )}
        >
          <Icon icon={icon} />
        </button>
      ))}
    </div>
  )
}
