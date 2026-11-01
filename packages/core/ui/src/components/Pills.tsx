import type { ReactElement, ReactNode } from "react"
import { useUiMessages } from "../locale/locale-provider.js"
import { resolveTone, TONE_BORDER, TONE_DOT, TONE_SOFT, type ToneName } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"

export interface LivePillProps {
  /** Status tone driving the dot, tint and border. Default `"info"`. */
  tone?: ToneName
  /** Pill label. Defaults to the locale's "Live". */
  children?: ReactNode
  className?: string
}

/**
 * Small tinted pill with a pulsing dot. Use in a widget header to signal that
 * the data is live/real-time. Tone-based (tint, border and dot in the tone,
 * text in the foreground), so it inherits the active theme. The pulse stops
 * under `prefers-reduced-motion`.
 */
export function LivePill({ tone = "info", children, className }: LivePillProps) {
  const messages = useUiMessages()
  const t = resolveTone(tone, "info")
  return (
    <span
      className={cn(
        "text-small inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 font-semibold",
        TONE_SOFT[t],
        TONE_BORDER[t],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full motion-safe:animate-pulse", TONE_DOT[t])}
      />
      {children ?? messages.pills.live}
    </span>
  )
}

/** The words a {@link StatusBadge} must carry: text, a number or an element — never nothing. */
export type StatusBadgeText = string | number | ReactElement | (string | number | ReactElement)[]

export interface StatusBadgeProps {
  /** The state, in words ("Suspended", "3 open incidents"). Required: colour is never the only signal. */
  children: StatusBadgeText
  /** The state's tone: tint, edge and dot. */
  tone: ToneName
  className?: string
}

/**
 * A state in words, marked in its tone: tint, edge and a static dot next to
 * foreground text (CI §3.3: the colour marks the state, the words say it).
 * For a detail-page header (`WidgetHeader`'s `badge`) or a table cell. The
 * text is required — a badge without words would make colour the only
 * signal. The pulsing dot is {@link LivePill}'s live-data semantic.
 */
export function StatusBadge({ children, tone, className }: StatusBadgeProps) {
  const t = resolveTone(tone)
  return (
    <span
      data-slot="status-badge"
      data-tone={t}
      className={cn(
        "text-small inline-flex w-fit items-center gap-1.5 rounded-sm border px-2.5 py-0.5 font-semibold",
        TONE_SOFT[t],
        TONE_BORDER[t],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT[t])} />
      {children}
    </span>
  )
}

export interface CountPillProps {
  /** Status tone driving the tint and border. Default `"neutral"`. */
  tone?: ToneName
  /** The count/value to display (tabular numbers). */
  children: ReactNode
  className?: string
}

/**
 * Compact count badge — tabular numbers on a tinted background with a border
 * in the tone. Use as the right-aligned indicator on a list/group row (e.g. a
 * per-group item count). The number stays in the foreground in every tone
 * (no coloured digits): the tint and the border carry the tone. A count
 * without a state stays `neutral`.
 */
export function CountPill({ tone = "neutral", children, className }: CountPillProps) {
  const t = resolveTone(tone)
  return (
    <span
      className={cn(
        "text-dense inline-flex min-w-10 items-center justify-center rounded-sm border px-2.5 py-0.5 font-semibold tabular-nums",
        TONE_SOFT[t],
        TONE_BORDER[t],
        className,
      )}
    >
      {children}
    </span>
  )
}
