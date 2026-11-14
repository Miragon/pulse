import type { ReactNode } from "react"
import { TONE_ICON } from "../lib/tone-utils.js"
import { resolveTone } from "../tones/index.js"
import { cn } from "../lib/utils.js"

/** Heading element for an empty/error state title (the surface decides the outline level). */
export type StateHeadingLevel = "h2" | "h3" | "h4" | "p"

export interface EmptyStateProps {
  /**
   * Icon or mark above the title, rendered decoratively (`aria-hidden`): a
   * Lucide icon for the concrete situation (e.g. `<CircleCheck />` for "all
   * done"), or a brand mark (an app passes its logo; a customer brand passes
   * its own or nothing). An SVG renders at 24 px unless it carries its own
   * `size-*` class, so a mark can be larger (`<Komet className="size-12" />`).
   */
  icon?: ReactNode
  /** Colour of the icon slot: `"neutral"` (muted, default) or `"success"` ("all done"). */
  tone?: "neutral" | "success"
  /** What is empty, in plain words ("No open incidents"). */
  title: ReactNode
  /** One help line: why it is empty or what to do next. */
  description?: ReactNode
  /** The primary next step (a `Button`). */
  action?: ReactNode
  /** An optional second, quieter step. Empty states carry at most two actions. */
  secondaryAction?: ReactNode
  /** Element of the title. Default `"h3"` (inside a widget below its own heading). */
  titleAs?: StateHeadingLevel
  /**
   * `"compact"` (default): in a table, a card or a view's body, in 13 px with the dense
   * geometry. `"page"`: a whole app surface (a landing, a first start), the help line in 16 px.
   */
  size?: "compact" | "page"
  className?: string
}

/** Per size: the box, the title and the help line. */
const SIZE = {
  compact: {
    box: "gap-3 px-3 py-6",
    title: "text-dense",
    description: "text-dense text-muted-foreground",
  },
  page: {
    box: "gap-2 px-4 py-8",
    title: "text-body",
    description: "text-body text-muted-foreground",
  },
} as const satisfies Record<
  NonNullable<EmptyStateProps["size"]>,
  { box: string; title: string; description: string }
>

/** The icon slot in the tone's icon colour (`TONE_ICON`): quiet, or the success tone. */
const ICON_TONE: Record<NonNullable<EmptyStateProps["tone"]>, string> = {
  neutral: TONE_ICON.neutral,
  success: TONE_ICON.success,
}

/**
 * The one empty-state pattern: icon or mark, a title (600), one help line and
 * up to two actions, centred in the space the content would take. Compact by
 * default (the webview's empty hint: 24 px above and below, 13 px, the help
 * line quiet); `size="page"` on an app surface. Static (no live region): it
 * replaces content, it does not announce a change.
 */
export function EmptyState({
  icon,
  tone = "neutral",
  title,
  description,
  action,
  secondaryAction,
  titleAs: Title = "h3",
  size = "compact",
  className,
}: EmptyStateProps) {
  // An untyped tone resolves (`ok` → success); anything else stays quiet.
  const iconTone = resolveTone(tone) === "success" ? "success" : "neutral"
  return (
    <div
      data-slot="empty-state"
      data-size={size}
      className={cn("flex flex-col items-center text-center", SIZE[size].box, className)}
    >
      {icon && (
        <div
          aria-hidden="true"
          className={cn(
            "flex items-center justify-center [&_svg:not([class*='size-'])]:size-6",
            ICON_TONE[iconTone],
          )}
        >
          {icon}
        </div>
      )}
      <div className="flex flex-col items-center gap-1">
        <Title className={cn("text-foreground font-semibold", SIZE[size].title)}>{title}</Title>
        {description && (
          <p className={cn("max-w-prose text-balance", SIZE[size].description)}>{description}</p>
        )}
      </div>
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
