import type { ReactNode } from "react"
import { CircleAlert, Info, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react"
import { useUiMessages } from "../locale/locale-provider.js"
import { Button } from "../primitives/button.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { TONE_BORDER, TONE_ICON } from "../lib/tone-utils.js"
import { resolveTone } from "../tones/index.js"
import { cn } from "../lib/utils.js"
import type { StateHeadingLevel } from "./EmptyState.js"

/** Status tone of an {@link ErrorState}. */
export type ErrorStateTone = "danger" | "warning" | "info"

export interface ErrorStateProps {
  /** What happened, in plain words ("This view couldn't be loaded"). */
  title: ReactNode
  /** What you can do next, or the human reason when you can map the raw one. */
  description?: ReactNode
  /**
   * The raw technical reason (engine exception, HTTP status), shown collapsed
   * under a "Details" disclosure so it informs without leading.
   */
  details?: ReactNode
  /** Summary text of the details disclosure. Default: the locale's "Details". */
  detailsLabel?: string
  /** Renders a retry button when set. */
  onRetry?: () => void
  /** Retry button label. Default: the locale's "Try again". */
  retryLabel?: string
  /** Further actions after the retry button (e.g. a link to another view). */
  actions?: ReactNode
  /**
   * Default `"danger"`. `"warning"` for partial failures, `"info"` for
   * notices. An untyped retired name still resolves (`error` → `danger`).
   */
  tone?: ErrorStateTone
  /** Replace the tone's default Lucide icon. */
  icon?: LucideIcon
  /**
   * `"block"` (default): the state that replaces a whole view or widget body.
   * `"inline"`: a compact alert above content that still renders.
   */
  variant?: "block" | "inline"
  /**
   * Live-region role. Default `"alert"`: an error that appears after the
   * fact is announced. Use `"status"` for a quieter notice, or `"none"` when
   * the state is part of the first paint.
   */
  role?: "alert" | "status" | "none"
  /** Element of the title. Default `"h2"` for `block`, `"p"` for `inline`. */
  titleAs?: StateHeadingLevel
  className?: string
}

const STATE_ICON: Record<ErrorStateTone, LucideIcon> = {
  danger: CircleAlert,
  warning: TriangleAlert,
  info: Info,
}

/**
 * The state's tone from whatever arrives: its three tones as is, a retired
 * name through `resolveTone` (`error` → `danger`, `notice` → `info`), any
 * other tone or unknown name as the default `danger`. A tone from untyped
 * data (plain JS, the wire) never crashes the view on a missing icon.
 */
function stateTone(name: unknown): ErrorStateTone {
  const tone = resolveTone(name, "danger")
  return tone === "warning" || tone === "info" ? tone : "danger"
}

/** Per variant: the title's element unless `titleAs` says otherwise. */
const DEFAULT_TITLE: Record<NonNullable<ErrorStateProps["variant"]>, StateHeadingLevel> = {
  block: "h2",
  inline: "p",
}

/** The guide's status surface per tone: the tone's tint on light, neutral on dark. */
const TONE_SURFACE: Record<ErrorStateTone, string> = {
  danger: "bg-danger-surface",
  warning: "bg-warning-surface",
  info: "bg-info-surface",
}

/** The tone's 4 px edge on the left, a real border (forced colours keep it). */
const TONE_EDGE: Record<ErrorStateTone, string> = {
  danger: "border-l-danger",
  warning: "border-l-warning",
  info: "border-l-info",
}

/**
 * The box in high contrast: no shadow (the theme's), the rim in the field edge's colour (kontur)
 * with the tone's edge kept; in forced colours all of it CanvasText.
 */
const CONTRAST =
  "in-[[data-cd-kontrast=hoch]]:border-y-border in-[[data-cd-kontrast=hoch]]:border-r-border forced-colors:border-[color:CanvasText]"

/**
 * The one error pattern, the guide's status box (§8): on the tone's status surface with a 1 px
 * rim and a 4 px edge on the left in the tone, the second shadow and the md radius, at most
 * 560 px wide; a 16 px Lucide icon, a title at 600 that says what happened, a line that says
 * what you can do, the raw reason collapsed under "Details", and the retry and further actions
 * beside it (below it in a box under 30rem). All of it in 13 px. `inline` stands above content
 * that still renders (failed data steps), `block` replaces a whole view or widget body; they
 * differ in the title's element.
 */
export function ErrorState({
  title,
  description,
  details,
  detailsLabel,
  onRetry,
  retryLabel,
  actions,
  tone: toneProp,
  icon,
  variant = "block",
  role = "alert",
  titleAs,
  className,
}: ErrorStateProps) {
  const tone = stateTone(toneProp)
  const Icon = icon ?? STATE_ICON[tone]
  const Title = titleAs ?? DEFAULT_TITLE[variant]
  // Every word on the surface is the foreground (CI §3.3); the icon and the rims carry the tone.
  return (
    <div
      data-slot="error-state"
      data-variant={variant}
      data-tone={tone}
      role={role === "none" ? undefined : role}
      className={cn(
        "text-dense text-foreground shadow-2 @container/status w-full max-w-[min(560px,100%)] rounded-md border border-l-4",
        TONE_SURFACE[tone],
        TONE_BORDER[tone],
        TONE_EDGE[tone],
        CONTRAST,
        className,
      )}
    >
      <div className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-2 py-2.5 pr-3 pl-3">
        <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", TONE_ICON[tone])} />
        <div className="flex min-w-0 flex-col gap-1">
          <Title className="text-dense font-semibold">{title}</Title>
          {description && <div className="text-dense [overflow-wrap:anywhere]">{description}</div>}
          {details && <ErrorDetails label={detailsLabel}>{details}</ErrorDetails>}
        </div>
        <ErrorActions onRetry={onRetry} retryLabel={retryLabel} actions={actions} />
      </div>
    </div>
  )
}

/**
 * The raw reason, collapsed: a native disclosure (keyboard + screen-reader
 * ready). It sits on the tint, so its text stays the foreground; the collapse
 * and the small mono type keep it quieter than the title.
 */
function ErrorDetails({ label, children }: { label: string | undefined; children: ReactNode }) {
  const messages = useUiMessages()
  return (
    <details className="text-small">
      <summary className={`w-fit cursor-pointer rounded-sm py-0.5 select-none ${FOCUS_RING}`}>
        {label ?? messages.common.details}
      </summary>
      <pre className="mt-1 font-mono break-words whitespace-pre-wrap">{children}</pre>
    </details>
  )
}

function ErrorActions({
  onRetry,
  retryLabel,
  actions,
}: {
  onRetry: (() => void) | undefined
  retryLabel: string | undefined
  actions: ReactNode
}) {
  const messages = useUiMessages()
  if (!onRetry && !actions) return null
  return (
    <div
      data-slot="error-state-actions"
      className="flex flex-wrap items-center gap-2 self-center @max-[30rem]/status:col-span-2 @max-[30rem]/status:col-start-2"
    >
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          {retryLabel ?? messages.common.retry}
        </Button>
      )}
      {actions}
    </div>
  )
}
