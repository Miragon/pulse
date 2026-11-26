import type { ReactElement, ReactNode } from "react"
import { TONE_BORDER, TONE_DOT, TONE_SOFT } from "../lib/tone-utils.js"
import { resolveTone, type ToneName } from "../tones/index.js"
import { cn } from "../lib/utils.js"

/** The words a {@link StatusBadge} must carry: text, a number or an element, never nothing. */
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
 * text is required: a badge without words would make colour the only
 * signal. Its dot is static: a view says when its data was read in its bar's
 * freshness slot, never with a pill that claims live data.
 */
export function StatusBadge({ children, tone, className }: StatusBadgeProps) {
  const t = resolveTone(tone)
  return (
    <span
      data-slot="status-badge"
      data-tone={t}
      className={cn(
        "text-small min-h-badge inline-flex w-fit items-center gap-1.5 rounded-sm border px-2.5 leading-4 font-semibold",
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
 * Compact count badge: tabular numbers on a tinted background with a border
 * in the tone, a 20 px pill (the badge height of the density roles; counts as
 * pills are a named deviation), 13 px at 600. Use as the right-aligned
 * indicator on a list/group row (e.g. a per-group item count). The number
 * stays in the foreground in every tone (no coloured digits): the tint and the
 * border carry the tone. A count without a state stays `neutral`. An icon in
 * it is 12 px (`Icon dense`).
 */
export function CountPill({ tone = "neutral", children, className }: CountPillProps) {
  const t = resolveTone(tone)
  return (
    <span
      className={cn(
        "text-small min-h-badge rounded-pill inline-flex min-w-5 items-center justify-center gap-1 border px-1.5 leading-4 font-semibold tabular-nums",
        TONE_SOFT[t],
        TONE_BORDER[t],
        className,
      )}
    >
      {children}
    </span>
  )
}
