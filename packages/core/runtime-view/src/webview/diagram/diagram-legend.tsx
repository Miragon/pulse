import { useId } from "react"
import { CircleQuestionMarkIcon } from "lucide-react"
import { Button, Icon } from "@miragon/pulse-ui"
import { CountBadge } from "../components/count-badge.js"

type BadgeSign = "running" | "incident" | "propagated"

const ENTRIES: readonly (readonly [sign: BadgeSign, text: string])[] = [
  ["running", "waiting here"],
  ["incident", "incident here"],
  ["propagated", "incident in a called instance"],
]

export interface DiagramLegendProps {
  readonly scope?: string
}

export function DiagramLegend({ scope }: DiagramLegendProps) {
  const legendId = useId()
  return (
    <div className="text-muted-foreground ml-auto flex flex-none items-center">
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground [anchor-name:--pulse-legend]"
        popoverTarget={legendId}
        aria-label="Legend"
        title="Legend"
      >
        <Icon icon={CircleQuestionMarkIcon} className="size-4" />
      </Button>
      <div
        id={legendId}
        popover="auto"
        className="border-border bg-popover text-dense text-popover-foreground shadow-2 inset-auto m-0 mb-1.5 rounded-md border px-3 py-2 leading-6 [position-anchor:--pulse-legend] [position-area:top_span-left]"
      >
        {scope !== undefined && <p className="font-semibold">{scope}.</p>}
        {ENTRIES.map(([sign, text]) => (
          <p key={sign} className="flex items-center gap-1.5">
            <CountBadge variant={sign} legend />
            {text}
          </p>
        ))}
      </div>
    </div>
  )
}
