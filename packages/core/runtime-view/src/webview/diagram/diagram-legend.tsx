import { useId } from "react"
import { CircleQuestionMarkIcon } from "lucide-react"
import { Button, cn, Icon } from "@miragon/pulse-ui"
import { CountBadge } from "../components/count-badge.js"

type LegendKind = "badges" | "markers"

type Entry = readonly [sign: string, text: string]

const ENTRIES: Readonly<Record<LegendKind, readonly Entry[]>> = {
  badges: [
    ["running", "waiting here"],
    ["incident", "incident here"],
    ["propagated", "incident in a called instance"],
  ],
  markers: [
    ["waiting", "waiting here"],
    ["incident", "incident here"],
    ["called", "incident in a called instance"],
    ["completed", "already done; green lines are the flows it took"],
  ],
}

function Sign({ kind, sign }: { readonly kind: LegendKind; readonly sign: string }) {
  return kind === "badges" ? (
    <CountBadge variant={sign as "running" | "incident" | "propagated"} legend />
  ) : (
    <span className={cn("legend-swatch", `legend-swatch--${sign}`)} aria-hidden="true" />
  )
}

export interface DiagramLegendProps {
  readonly kind: LegendKind
  readonly scope?: string
}

export function DiagramLegend({ kind, scope }: DiagramLegendProps) {
  const entries = ENTRIES[kind]
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
        {entries.map(([sign, text]) => (
          <p key={sign} className="flex items-center gap-1.5">
            <Sign kind={kind} sign={sign} />
            {text}
          </p>
        ))}
      </div>
    </div>
  )
}
