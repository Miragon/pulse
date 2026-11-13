import type { MouseEvent } from "react"
import { CircleX, TriangleAlert, type LucideIcon } from "lucide-react"
import { formatCompactCount, type Count } from "../format/index.js"
import { Icon } from "../kit/icon.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { TONE_ICON } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"
import { SITUATION_TONES, type Situation, type ToneVariant } from "../tones/index.js"

export interface CountBadgeProps {
  /** The count, compact on screen (`1.2k`); leave it out for the badge as a sign (a legend). */
  count?: Count
  /**
   * The exact count and what it counts, in words ("3 instances with an incident"): the badge's
   * accessible name and its title. Required: a number alone means nothing.
   */
  label: string
  /**
   * What it counts, whose tone `SITUATION_TONES` gives. An alarming count (danger, warning) draws
   * the tone's icon of its own shape before the number; the number stays in the foreground.
   * Default: a count without a state.
   */
  situation?: Situation
  /**
   * On a BPMN diagram, the named deviation: the badge fills in its tone. An open incident on the
   * danger fill and a running count on the primary, both with white text; an incident in a called
   * instance outlined in danger.
   */
  diagram?: boolean
  /** From an older read: on the raised surface with the field edge, the tone held back. */
  stale?: boolean
  /** `legend`: the smaller sign a legend explains (16 px high). */
  size?: "default" | "legend"
  /** Makes the badge a button (a filter by what it counts) with a 24 px target around it. */
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  className?: string
}

const TONE_GLYPH: Partial<Record<ToneVariant, LucideIcon>> = {
  danger: CircleX,
  warning: TriangleAlert,
}

/** A count as a figure: the raised surface, a line edge, the number in the foreground. */
const PLAIN = "bg-raised text-foreground border-border"

/** The diagram's fills, per situation that has one; any other situation draws as {@link PLAIN}. */
const DIAGRAM_FILL: Partial<Record<Situation, string>> = {
  openIncident: "bg-destructive text-destructive-foreground border-transparent",
  jobWithoutRetries: "bg-destructive text-destructive-foreground border-transparent",
  running: "bg-primary text-primary-foreground border-transparent",
  incidentInCalledInstance: "bg-raised text-foreground border-danger border-[1.5px]",
}

const SIZE = {
  default: "min-h-badge min-w-5 px-1.5",
  legend: "min-h-4 min-w-6 px-1",
} as const

/** Edges, never shadows; forced colours draw it in the system's text and canvas. */
const FORCED =
  "forced-colors:border-[color:CanvasText] forced-colors:bg-[color:Canvas] forced-colors:text-[color:CanvasText] forced-colors:forced-color-adjust-none"

/** The fill and its icon's colour: plain, the diagram's fill, or stale. */
function look(situation: Situation | undefined, diagram: boolean, stale: boolean) {
  const tone = situation === undefined ? "neutral" : SITUATION_TONES[situation]
  if (stale) return { tone, fill: "bg-raised text-foreground border-input", icon: undefined }
  const filled = diagram && situation !== undefined ? DIAGRAM_FILL[situation] : undefined
  const outlined = situation === "incidentInCalledInstance"
  return {
    tone,
    fill: filled ?? PLAIN,
    // On a fill the icon takes the fill's text colour; on the raised surface the tone's.
    icon: filled !== undefined && !outlined ? undefined : TONE_ICON[tone],
  }
}

/**
 * A count as a 20 px pill (pills for counts: a named deviation), 13 px at 600 in tabular figures.
 * Numbers stay neutral (invariant 6): an alarming count shows its tone by a 12 px icon of the
 * tone's own shape (a circled cross for danger, a triangle for warning) before the number and
 * says what it counts in words (`label`, the accessible name with the exact count), never by a
 * coloured number. On a BPMN diagram (`diagram`) it fills in its tone, the named deviation the
 * diagram's badges keep. Rings are edges, so forced colours keep them. As a button it has a 24 px
 * target around the pill (WCAG 2.5.8).
 */
export function CountBadge({
  count,
  label,
  situation,
  diagram = false,
  stale = false,
  size = "default",
  onClick,
  className,
}: CountBadgeProps) {
  const { tone, fill, icon } = look(situation, diagram, stale)
  const glyph = TONE_GLYPH[tone]
  const classes = cn(
    "text-small inline-flex shrink-0 items-center justify-center gap-0.5 rounded-pill border leading-none font-semibold whitespace-nowrap tabular-nums",
    SIZE[size],
    glyph && "pl-1",
    fill,
    FORCED,
    className,
  )
  const content = (
    <>
      {glyph && <Icon icon={glyph} dense className={icon} />}
      {count !== undefined && <span aria-hidden="true">{formatCompactCount(count)}</span>}
      <span className="sr-only">{label}</span>
    </>
  )
  if (!onClick) {
    return (
      <span data-slot="count-badge" data-tone={tone} title={label} className={classes}>
        {content}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-slot="count-badge"
      data-tone={tone}
      title={label}
      onClick={onClick}
      className={cn(
        classes,
        "relative cursor-pointer before:absolute before:-inset-0.5 before:min-h-6 before:min-w-6 before:content-['']",
        FOCUS_RING,
      )}
    >
      {content}
    </button>
  )
}
