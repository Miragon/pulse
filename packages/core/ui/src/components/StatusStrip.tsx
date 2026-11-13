import { CircleX, Info, LoaderCircle, TriangleAlert, type LucideIcon } from "lucide-react"
import { Icon } from "../kit/icon.js"
import { BAR_CONTAINER } from "../lib/bar.js"
import { TONE_BORDER, TONE_ICON } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"
import { Button } from "../primitives/button.js"

/** The tone of a {@link StatusStrip}: what the notice is about. */
export type StatusStripTone = "danger" | "warning" | "info"

/** One action of a {@link StatusStrip}: a 24 px button whose label hides visually in a narrow strip. */
export interface StatusStripAction {
  /** The action's words, its name. */
  label: string
  /** A 16 px icon before the label; with it the label may collapse to the icon in a narrow strip. */
  icon?: LucideIcon
  onClick: () => void
  /**
   * While the action runs: its words for it ("Retrying…"). The button then shows a spinner and
   * refuses a press (`aria-disabled`), keeping the focus where it is.
   */
  busyLabel?: string
  /** Not available now: announced as dimmed, still reachable (`aria-disabled`). */
  disabled?: boolean
}

export interface StatusStripProps {
  tone: StatusStripTone
  /** What happened, in words: it never gives way to the detail. */
  title: string
  /** The rest of the message: on one line it is cut first, under 30rem it wraps instead. */
  detail?: string
  actions?: readonly StatusStripAction[]
  /** Replaces the tone's icon (CircleX, TriangleAlert, Info). */
  icon?: LucideIcon
  className?: string
}

const TONE_GLYPH: Readonly<Record<StatusStripTone, LucideIcon>> = {
  danger: CircleX,
  warning: TriangleAlert,
  info: Info,
}

/** The guide's status surface: the tone's tint on light, neutral on dark (the `-surface` role). */
const TONE_SURFACE: Readonly<Record<StatusStripTone, string>> = {
  danger: "bg-danger-surface",
  warning: "bg-warning-surface",
  info: "bg-info-surface",
}

/**
 * A strip action's label hides visually in a strip under 36rem when it has an icon, and stays its
 * name (`sr-only`, never `display: none`); the button turns square around the icon.
 */
const ACTION_COLLAPSE =
  "@max-[36rem]/bar:has-[>svg]:min-w-control-xs @max-[36rem]/bar:has-[>svg]:px-0 @max-[36rem]/bar:has-[>svg]:[&>[data-slot=button-label]]:sr-only"

/** Refused while busy or unavailable: quiet, no hover, the not-allowed cursor; never faded. */
const ACTION_REFUSED =
  "aria-disabled:cursor-not-allowed aria-disabled:text-muted-foreground aria-disabled:hover:border-border aria-disabled:hover:bg-raised aria-disabled:hover:text-muted-foreground"

/**
 * The title and the detail on the strip's one line: cut with an ellipsis (the line keeps its
 * nowrap), the detail first; under 30rem the line wraps and so does a long word.
 */
const LINE_PART = "min-w-0 overflow-hidden text-ellipsis @max-[30rem]/bar:[overflow-wrap:anywhere]"

function StripAction({ action }: { action: StatusStripAction }) {
  const busy = action.busyLabel !== undefined
  const refused = busy || action.disabled === true
  const label = action.busyLabel ?? action.label
  const glyph = busy ? LoaderCircle : action.icon
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      title={label}
      aria-disabled={refused || undefined}
      onClick={refused ? undefined : action.onClick}
      className={cn(ACTION_COLLAPSE, ACTION_REFUSED)}
    >
      {glyph && (
        <Icon
          icon={glyph}
          className={
            busy ? "motion-safe:animate-spin [.cd-shell-reduce-motion_&]:animate-none" : undefined
          }
        />
      )}
      <span data-slot="button-label">{label}</span>
    </Button>
  )
}

/**
 * A notice docked under a view's bar (the webview's strip), never a floating card: one line on
 * the tone's status surface with a rule in the tone below (2 px in high contrast, CanvasText in
 * forced colours), without the guide's 4 px edge (a named deviation): the tone's 16 px icon, the
 * title at 600, the detail after it, cut first where the line runs out (its whole text in the
 * title) and wrapping onto a second line under 30rem instead, and the actions as 24 px buttons.
 * Its message is a live region, `alert` for danger and `status` otherwise, and the actions sit
 * outside it: it announces when it appears and when its words change, never on a re-render or
 * when an action turns busy.
 */
export function StatusStrip({
  tone,
  title,
  detail,
  actions = [],
  icon,
  className,
}: StatusStripProps) {
  const full = detail === undefined ? title : `${title} ${detail}`
  return (
    <div
      data-slot="status-strip"
      data-tone={tone}
      className={cn(
        BAR_CONTAINER,
        "text-foreground min-w-0 border-b",
        TONE_SURFACE[tone],
        TONE_BORDER[tone],
        "in-[[data-cd-kontrast=hoch]]:border-b-2 forced-colors:border-[color:CanvasText]",
        className,
      )}
    >
      <div className="flex min-h-8 items-center gap-2 py-0.5 pr-2 pl-3 @max-[30rem]/bar:flex-wrap">
        <Icon
          icon={icon ?? TONE_GLYPH[tone]}
          className={cn(TONE_ICON[tone], "forced-colors:forced-color-adjust-none")}
        />
        <p
          role={tone === "danger" ? "alert" : "status"}
          aria-atomic="true"
          title={full}
          className="text-dense flex min-w-0 flex-1 gap-2 whitespace-nowrap @max-[30rem]/bar:flex-wrap @max-[30rem]/bar:gap-y-0 @max-[30rem]/bar:whitespace-normal"
        >
          <span className={cn(LINE_PART, "font-semibold")}>{title}</span>
          {detail !== undefined && <span className={cn(LINE_PART, "shrink-[1000]")}>{detail}</span>}
        </p>
        {actions.length > 0 && (
          <div data-slot="status-strip-actions" className="flex shrink-0 items-center gap-1.5">
            {actions.map((action) => (
              <StripAction key={action.label} action={action} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
