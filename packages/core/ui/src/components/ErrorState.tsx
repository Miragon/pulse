import type { ReactNode } from "react"
import { CircleAlert, Info, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react"
import { useUiMessages } from "../locale/locale-provider.js"
import { Button } from "../primitives/button.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { TONE_BORDER, TONE_ICON, TONE_SOFT } from "../lib/tone-utils.js"
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

/**
 * Per-variant geometry: `block` replaces a surface and reads as running text
 * (16 px), `inline` is the compact alert box above content that still renders
 * (14 px, the dense-controls exception of the type scale). The icon is 16 px
 * in both, a CI size, centred on the title's first line.
 */
const VARIANT = {
  block: {
    box: "gap-4 p-4",
    iconOffset: "mt-1",
    title: "text-body",
    description: "text-body",
    defaultTitleAs: "h2",
    retry: "default",
  },
  inline: {
    box: "gap-3 px-4 py-3 text-dense",
    iconOffset: "mt-0.5",
    title: "text-dense",
    description: "text-dense",
    defaultTitleAs: "p",
    retry: "outline",
  },
} as const satisfies Record<
  NonNullable<ErrorStateProps["variant"]>,
  {
    box: string
    iconOffset: string
    title: string
    description: string
    defaultTitleAs: StateHeadingLevel
    retry: "default" | "outline"
  }
>

/**
 * The one error pattern: a Lucide icon, a title that says what happened, a
 * line that says what you can do, the raw reason collapsed under "Details",
 * and a retry. `inline` is the alert form above content that still renders
 * (failed data steps); `block` replaces a whole view or widget body.
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
  const style = VARIANT[variant]
  const Icon = icon ?? STATE_ICON[tone]
  const Title = titleAs ?? style.defaultTitleAs
  // The status colour as rim, tint and icon; every word on the tint is the
  // foreground (TONE_SOFT, CI §3.3). On dark the tint is transparent and the
  // rim carries the tone.
  return (
    <div
      data-slot="error-state"
      data-variant={variant}
      data-tone={tone}
      role={role === "none" ? undefined : role}
      className={cn(
        "flex items-start rounded-md border",
        style.box,
        TONE_SOFT[tone],
        TONE_BORDER[tone],
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-4 shrink-0", style.iconOffset, TONE_ICON[tone])}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Title className={cn("font-semibold", style.title)}>{title}</Title>
        {description && <div className={cn("break-words", style.description)}>{description}</div>}
        {details && <ErrorDetails label={detailsLabel}>{details}</ErrorDetails>}
        <ErrorActions
          onRetry={onRetry}
          retryLabel={retryLabel}
          retryVariant={style.retry}
          actions={actions}
        />
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
  retryVariant,
  actions,
}: {
  onRetry: (() => void) | undefined
  retryLabel: string | undefined
  retryVariant: "default" | "outline"
  actions: ReactNode
}) {
  const messages = useUiMessages()
  if (!onRetry && !actions) return null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {onRetry && (
        <Button type="button" size="sm" variant={retryVariant} onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          {retryLabel ?? messages.common.retry}
        </Button>
      )}
      {actions}
    </div>
  )
}
