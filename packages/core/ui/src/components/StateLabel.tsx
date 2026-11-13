import type { ReactNode } from "react"
import {
  Ban,
  CircleCheck,
  CircleDot,
  CircleStop,
  CircleX,
  Pause,
  type LucideIcon,
} from "lucide-react"
import { Icon } from "../kit/icon.js"
import { TONE_ICON } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"
import { useUiMessages } from "../locale/locale-provider.js"
import type { StateLabelMessages } from "../locale/ui-messages.js"
import { SITUATION_TONES, type Situation } from "../tones/index.js"

/** The states a {@link StateLabel} names: an instance's or a step's, and an open incident. */
export type StateLabelState = keyof StateLabelMessages

/** Each state's situation, whose tone the icon takes (`SITUATION_TONES`). */
const SITUATION: Readonly<Record<StateLabelState, Situation>> = {
  running: "running",
  suspended: "suspended",
  completed: "ended",
  cancelled: "ended",
  ended: "ended",
  incident: "openIncident",
}

/** One shape per state, so the state reads without its colour (forced colours, colour vision). */
const GLYPH: Readonly<Record<StateLabelState, LucideIcon>> = {
  running: CircleDot,
  suspended: Pause,
  completed: CircleCheck,
  cancelled: Ban,
  ended: CircleStop,
  incident: CircleX,
}

export interface StateLabelProps {
  state: StateLabelState
  /** Other words for the state; default: the kit's one word for it ("Running", "Läuft"). */
  children?: ReactNode
  className?: string
}

/**
 * A state as a 16 px icon in its situation's tone and the state's word in the foreground (the
 * webview's state label): no pill, no dot, no edge. Each state has an icon of its own shape and
 * one word in every Pulse UI. For a state in a table cell or a list; several in one cell sit
 * `gap-3` apart. A header's state may stay a `StatusBadge`. Its baseline is its word's (the icon
 * centred beside it), so it sits on the line of a term beside it (`Facts`).
 */
export function StateLabel({ state, children, className }: StateLabelProps) {
  const { stateLabel } = useUiMessages()
  const tone = SITUATION_TONES[SITUATION[state]]
  const text = children ?? stateLabel[state]
  return (
    <span
      data-slot="state-label"
      data-state={state}
      data-tone={tone}
      title={typeof text === "string" ? text : undefined}
      className={cn("text-dense inline-flex min-w-0 items-baseline gap-1.5", className)}
    >
      <Icon icon={GLYPH[state]} className={cn(TONE_ICON[tone], "self-center")} />
      <span className="text-foreground min-w-0 truncate">{text}</span>
    </span>
  )
}
