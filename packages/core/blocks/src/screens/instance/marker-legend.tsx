import { CircleQuestionMarkIcon } from "lucide-react"
import { useId, type ComponentType } from "react"
import { Button, Icon } from "@miragon/pulse-ui"
import type { MarkerKindCode } from "@miragon/pulse-screens"
import type { InstanceWordKey } from "../../messages/instance-en.js"
import { useInstanceWords } from "../../messages/instance-words.js"

/** The props of the surface's sample of a marker, as its diagram draws one. */
export interface MarkerSwatchProps {
  readonly kind: MarkerKindCode
}

export interface MarkerLegendProps {
  /**
   * Whether the surface's diagram draws the sequence flows the instance took (the editors' does):
   * the entry of a completed element says so.
   */
  readonly takenFlows?: boolean
  /** The surface's sample of each marker, as its diagram draws it, shown before its words. */
  readonly Swatch: ComponentType<MarkerSwatchProps>
}

const ENTRIES: readonly (readonly [MarkerKindCode, InstanceWordKey])[] = [
  ["waiting", "legend.waiting"],
  ["incident", "legend.incident"],
  ["incidentInCalledInstance", "legend.incidentInCalledInstance"],
  ["completed", "legend.completed"],
]

/**
 * The legend of an instance's diagram behind a button: what each marker says (waiting here, an
 * incident here, an incident in a called instance, already done), with the surface's sample of
 * each. It opens over the diagram and closes on Escape.
 */
export function MarkerLegend({ takenFlows = false, Swatch }: MarkerLegendProps) {
  const t = useInstanceWords()
  const legendId = useId()
  return (
    <div className="text-muted-foreground ml-auto flex flex-none items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground [anchor-name:--pulse-legend]"
        popoverTarget={legendId}
        aria-label={t("legend.label")}
        title={t("legend.label")}
      >
        <Icon icon={CircleQuestionMarkIcon} className="size-4" />
      </Button>
      <div
        id={legendId}
        popover="auto"
        className="border-border bg-popover text-dense text-popover-foreground shadow-2 inset-auto m-0 mb-1.5 rounded-md border px-3 py-2 leading-6 [position-anchor:--pulse-legend] [position-area:top_span-left]"
      >
        {ENTRIES.map(([kind, word]) => (
          <p key={kind} className="flex items-center gap-1.5">
            <Swatch kind={kind} />
            {t(kind === "completed" && takenFlows ? "legend.completedWithFlows" : word)}
          </p>
        ))}
      </div>
    </div>
  )
}
