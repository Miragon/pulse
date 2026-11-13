import type { ReactNode } from "react"
import { TONE_ICON } from "../lib/tone-utils.js"
import { resolveTone, type ToneName } from "../tones/index.js"
import { cn } from "../lib/utils.js"
import { ViewBar, type ViewBarHeadingLevel } from "./ViewBar.js"

/** Heading element of a {@link WidgetHeader} title. */
export type WidgetHeadingLevel = ViewBarHeadingLevel

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
   * `"default"` and `"detail"`: a view's header, its `ViewBar` (the title as the bar's 13 px
   * heading at 600, the chrome title of the guide); the two draw the same bar. `"app"`: the
   * app-level title (a landing, all engines), 28 px at 700 above its meta row.
   */
  size?: "default" | "detail" | "app"
  /** Inline after the title inside the heading (e.g. a version chip). */
  titleSuffix?: ReactNode
  /** The state in words: a `StatusBadge` or a `StateLabel`, after the title in a view's bar. */
  badge?: ReactNode
  /** Facts about the subject (a live pill, counts, an id): the bar's facts, in quiet 13 px text. */
  sub?: ReactNode
  /** The view's actions (buttons, drill controls), one group. */
  actions?: ReactNode
  /**
   * @deprecated The tinted tile is gone (the icon-tile pattern the CI rules out, anti-slop U2): a
   * view's bar draws the icon at 16 px before its title, the app-level title leaves it out. Say
   * a state in words with a `StatusBadge` in {@link WidgetHeaderProps.badge}.
   */
  icon?: ReactNode
  /** @deprecated The colour of the deprecated {@link WidgetHeaderProps.icon}, as an icon's tone. */
  iconTone?: ToneName
  className?: string
}

/**
 * The header at the top of a widget. A view's header is its `ViewBar` (the default): the title
 * as the bar's heading in 13 px at 600, the state after it, the facts and the actions, wrapping
 * where it gets narrow. At app level (`size="app"`, a landing, all engines) it is the hero: the
 * state above a 28 px title at 700, the meta row under it and the actions on the right. Use once
 * per widget surface.
 */
export function WidgetHeader({
  title,
  as = "h1",
  size = "default",
  titleSuffix,
  badge,
  sub,
  actions,
  icon,
  iconTone = "neutral",
  className,
}: WidgetHeaderProps) {
  if (size !== "app") {
    return (
      <ViewBar
        as={as}
        title={title}
        titleSuffix={titleSuffix}
        icon={icon && <span className={TONE_ICON[resolveTone(iconTone)]}>{icon}</span>}
        badge={badge}
        facts={sub}
        actions={actions}
        className={className}
      />
    )
  }
  return (
    <AppTitle
      as={as}
      title={title}
      titleSuffix={titleSuffix}
      badge={badge}
      sub={sub}
      actions={actions}
      className={className}
    />
  )
}

/** The app-level hero: the state above a 28 px title at 700, the meta row under it, the actions beside it. */
function AppTitle({
  as: Heading = "h1",
  title,
  titleSuffix,
  badge,
  sub,
  actions,
  className,
}: Pick<
  WidgetHeaderProps,
  "as" | "title" | "titleSuffix" | "badge" | "sub" | "actions" | "className"
>) {
  return (
    <header
      data-slot="widget-header"
      className={cn("flex flex-wrap items-start justify-between gap-4", className)}
    >
      <div className="min-w-0">
        {badge && <div className="mb-3">{badge}</div>}
        <Heading className="text-title text-foreground mb-1.5 tracking-tight break-words">
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
