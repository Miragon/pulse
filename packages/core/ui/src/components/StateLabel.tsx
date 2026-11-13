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
  /**
   * Below this width of the nearest container (a `DataTable`'s region is one; `sm` 24rem, `md`
   * 28rem) the label shows its icon alone, its word still read by a screen reader and in its
   * title. For a second state beside a first where a narrow table has no room for both words (an
   * open incident beside running): the icon's shape carries it, never its colour alone.
   */
  iconOnlyBelow?: "sm" | "md"
  className?: string
}

/** The container queries that drop the word from sight, never from a screen reader. */
const ICON_ONLY_BELOW = { sm: "@max-sm:sr-only", md: "@max-md:sr-only" } as const

/**
 * A state as a 16 px icon in its situation's tone and the state's word in the foreground (the
 * webview's state label): no pill, no dot, no edge. Each state has an icon of its own shape and
 * one word in every Pulse UI. For a state in a table cell or a list; several in one cell sit
 * `gap-3` apart. A header's state may stay a `StatusBadge`. Its baseline is its word's (the icon
 * centred beside it), so it sits on the line of a term beside it (`Facts`). In a narrow table a
 * second state may show its icon alone (`iconOnlyBelow`).
 */
export function StateLabel({ state, children, iconOnlyBelow, className }: StateLabelProps) {
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
      <span
        className={cn(
          "text-foreground min-w-0 truncate",
          iconOnlyBelow && ICON_ONLY_BELOW[iconOnlyBelow],
        )}
      >
        {text}
      </span>
    </span>
  )
}
