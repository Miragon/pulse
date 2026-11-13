import type { ReactNode } from "react"
import { CircleX, TriangleAlert, type LucideIcon } from "lucide-react"
import { Icon } from "../kit/icon.js"
import { TONE_ICON } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"
import { SITUATION_TONES, type Situation, type ToneVariant } from "../tones/index.js"

/** One shape per alarming tone, so the alarm reads without its colour (forced colours, colour vision). */
const TONE_GLYPH: Partial<Record<ToneVariant, LucideIcon>> = {
  danger: CircleX,
  warning: TriangleAlert,
}

export type CountFigureProps = {
  /** The figure, formatted (`formatNumber`, `formatCount`): it stays in the foreground. */
  children: ReactNode
  className?: string
} & (
  | { situation?: undefined; label?: undefined }
  | {
      /**
       * What the figure counts when it alarms (`openIncident`, `jobWithoutRetries`): its tone
       * (`SITUATION_TONES`) draws the tone's icon of its own shape before the figure. A situation
       * that does not alarm draws nothing.
       */
      situation: Situation
      /** Why it alarms, in words for a screen reader ("No retries left"), read after the figure. */
      label: string
    }
)

/**
 * A count as a plain figure (invariant 6: numbers stay neutral): the figure in the foreground in
 * tabular digits, never in a tone's colour or on a tint. An alarming count (an open incident, a
 * job without retries) draws its tone's 16 px icon of its own shape before the figure (a circled
 * cross for danger, a triangle for warning) and says why it alarms in words a screen reader reads
 * after the figure. For a figure in a table cell, a fact or a KPI tile; on its line's baseline, the
 * icon centred beside it. `CountBadge` is its pill, for a count at the end of a row.
 */
export function CountFigure({ children, situation, label, className }: CountFigureProps) {
  const tone: ToneVariant = situation === undefined ? "neutral" : SITUATION_TONES[situation]
  const glyph = TONE_GLYPH[tone]
  return (
    <span
      data-slot="count-figure"
      data-tone={tone}
      className={cn("inline-flex items-baseline gap-1.5 tabular-nums", className)}
    >
      {glyph && <Icon icon={glyph} className={cn(TONE_ICON[tone], "self-center")} />}
      <span>{children}</span>
      {glyph && label && <span className="sr-only">{label}</span>}
    </span>
  )
}
