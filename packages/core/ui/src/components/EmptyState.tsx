import type { ReactNode } from "react"
import { resolveTone, TONE_ICON } from "../lib/tone-utils.js"
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
  className?: string
}

/** The icon slot in the tone's icon colour (`TONE_ICON`): quiet, or the success tone. */
const ICON_TONE: Record<NonNullable<EmptyStateProps["tone"]>, string> = {
  neutral: TONE_ICON.neutral,
  success: TONE_ICON.success,
}

/**
 * The one empty-state pattern: icon or mark, a title (600), one help line and
 * up to two actions, centred in the space the content would take. Static (no
 * live region): it replaces content, it does not announce a change.
 */
export function EmptyState({
  icon,
  tone = "neutral",
  title,
  description,
  action,
  secondaryAction,
  titleAs: Title = "h3",
  className,
}: EmptyStateProps) {
  // An untyped tone resolves (`ok` → success); anything else stays quiet.
  const iconTone = resolveTone(tone) === "success" ? "success" : "neutral"
  return (
    <div
      data-slot="empty-state"
      className={cn("flex flex-col items-center gap-2 px-4 py-8 text-center", className)}
    >
      {icon && (
        <div
          aria-hidden="true"
          className={cn(
            "mb-1 flex items-center justify-center [&_svg:not([class*='size-'])]:size-6",
            ICON_TONE[iconTone],
          )}
        >
          {icon}
        </div>
      )}
      <Title className="text-foreground text-body font-semibold">{title}</Title>
      {description && (
        <p className="text-muted-foreground text-body max-w-prose text-balance">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}
