import { useId, useLayoutEffect, useRef } from "react"
import { CircleQuestionMarkIcon } from "lucide-react"
import { Button, cn, Icon, useUiMessages } from "../index.js"
import { CanvasBadge } from "./canvas-badge.js"
import { COUNT_ORDER, type DiagramCountKind } from "./diagram-marks.js"

/** The legend's line of each badge. */
const ENTRY: Readonly<
  Record<DiagramCountKind, "legendRunning" | "legendIncidents" | "legendIncidentsInCalledInstances">
> = {
  running: "legendRunning",
  incidents: "legendIncidents",
  incidentsInCalledInstances: "legendIncidentsInCalledInstances",
}

export interface DiagramLegendProps {
  /** Its first line: what the badges count ("Badges count running instances of v3"). */
  readonly scope?: string
  /** The badges it explains, in the diagram's order; default all three. */
  readonly kinds?: readonly DiagramCountKind[]
  /** Where it opens from its button: below it (default) or above it. */
  readonly placement?: "bottom" | "top"
  readonly className?: string
}

/**
 * The legend of a diagram's counts behind a button: what each badge says (waiting here, an
 * incident here, an incident in a called instance), each with its badge as `BpmnDiagram` draws it,
 * led by the page's line of what they count. It opens over the diagram and closes on Escape.
 */
export function DiagramLegend({
  scope,
  kinds = COUNT_ORDER,
  placement = "bottom",
  className,
}: DiagramLegendProps) {
  const words = useUiMessages().bpmn
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  // The popover sits at its own button: an anchor of this legend's own, so two on a page each
  // open at theirs.
  useLayoutEffect(() => {
    const anchor = `--pulse-legend-${id.replace(/[^\w-]/g, "")}`
    button.current?.style.setProperty("anchor-name", anchor)
    popover.current?.style.setProperty("position-anchor", anchor)
  }, [id])
  const popoverId = `${id}-legend`
  return (
    <div className={cn("text-muted-foreground flex flex-none items-center", className)}>
      <Button
        ref={button}
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground"
        popoverTarget={popoverId}
        aria-label={words.legendLabel}
        title={words.legendLabel}
      >
        <Icon icon={CircleQuestionMarkIcon} className="size-4" />
      </Button>
      <div
        ref={popover}
        id={popoverId}
        popover="auto"
        data-part="diagram-legend"
        className={cn(
          "border-border bg-popover text-dense text-popover-foreground shadow-2 inset-auto m-0 rounded-md border px-3 py-2 leading-6",
          placement === "top"
            ? "mb-1.5 [position-area:top_span-left]"
            : "mt-1.5 [position-area:bottom_span-left]",
        )}
      >
        {scope !== undefined && <p className="m-0 font-semibold">{scope}</p>}
        {kinds.map((kind) => (
          <p key={kind} className="m-0 flex items-center gap-1.5">
            <CanvasBadge kind={kind} legend />
            {words[ENTRY[kind]]}
          </p>
        ))}
      </div>
    </div>
  )
}
