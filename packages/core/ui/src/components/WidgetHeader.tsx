import type { ReactNode } from "react"
import { resolveTone, TONE_SOFT, type ToneName } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"

/** Heading element of a {@link WidgetHeader} title. */
export type WidgetHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6"

export interface WidgetHeaderProps {
  /** The widget title. */
  title: ReactNode
  /**
   * Heading element of the title. Default `"h1"`: the widget is the page.
   * Pick the level that keeps ONE outline per view: below a host toolbar's
   * title (an h2, say) use `"h3"`, inside a composed view under its own
   * heading one level below it. The size follows `size`, not the level.
   */
  as?: WidgetHeadingLevel
  /**
   * `"default"`: the page title (28 px / 700, the CI h2 style). `"detail"`:
   * the compact detail-page title (21 px / 600, the CI h3 style).
   */
  size?: "default" | "detail"
  /** Inline after the title inside the heading (e.g. a version chip). */
  titleSuffix?: ReactNode
  /** Above the title — a `StatusBadge` that says the state in words. */
  badge?: ReactNode
  /** Subtitle/meta row under the title (e.g. a live pill + counts), a 13 px caption row. */
  sub?: ReactNode
  /** Right-aligned actions slot (buttons, drill controls). */
  actions?: ReactNode
  /**
   * @deprecated A glyph in a tinted tile above every title is the icon-tile
   * pattern the CI rules out (anti-slop U2). Say a state in words with a
   * `StatusBadge` in {@link WidgetHeaderProps.badge}. Still rendered when set.
   */
  icon?: ReactNode
  /** @deprecated Tone of the deprecated {@link WidgetHeaderProps.icon} tile. */
  iconTone?: ToneName
  className?: string
}

const TITLE_SIZE: Record<NonNullable<WidgetHeaderProps["size"]>, string> = {
  default: "text-title",
  detail: "text-section",
}

/**
 * Page-level header at the top of a widget: an optional state badge, the
 * title (heading level per `as`, size per `size`), a subtitle/meta row and a
 * right-aligned actions slot. Use once per widget surface to anchor it.
 */
export function WidgetHeader({
  title,
  as: Heading = "h1",
  size = "default",
  titleSuffix,
  badge,
  sub,
  actions,
  icon,
  iconTone = "neutral",
  className,
}: WidgetHeaderProps) {
  return (
    <header
      data-slot="widget-header"
      className={cn("flex flex-wrap items-start justify-between gap-4", className)}
    >
      <div className="min-w-0">
        {icon && (
          <div
            aria-hidden="true"
            className={cn(
              "text-section mb-3.5 grid size-11 place-items-center rounded-md",
              TONE_SOFT[resolveTone(iconTone)],
            )}
          >
            {icon}
          </div>
        )}
        {badge && <div className="mb-3">{badge}</div>}
        <Heading
          className={cn("text-foreground mb-1.5 tracking-tight break-words", TITLE_SIZE[size])}
        >
          {title}
          {titleSuffix}
        </Heading>
        {sub && (
          <div className="text-muted-foreground text-small flex flex-wrap items-center gap-2">
            {sub}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
