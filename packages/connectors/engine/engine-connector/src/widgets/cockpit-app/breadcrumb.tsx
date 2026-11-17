import { FOCUS_RING, cn, Icon } from "@miragon/pulse-ui"
import { ChevronRight } from "lucide-react"
import { translator } from "../../messages/use-t.js"
import type { CockpitView } from "../../view-models.js"
import { type BoardView, crumbLabel, type CockpitScope, viewKey } from "../nav-core.js"

/** A crumb that leads back: the control's height (28 px, 36 px on touch) around its words. */
const CRUMB = cn("hover:text-foreground min-h-control inline-flex items-center rounded", FOCUS_RING)

/**
 * Every crumb pops back to the view it names, so back never re-drills from the top.
 * `rootLabel` adds a leading crumb that leaves the trail via `onPop(-1)`. `current` names the one
 * view of an engine shown on boards only in place of the stack's: its one state, no route's.
 */
export function NavBreadcrumb({
  stack,
  locale,
  onPop,
  rootLabel,
  current,
  className,
}: {
  stack: CockpitView[]
  locale: string
  onPop: (to: number) => void
  rootLabel?: string
  current?: string
  className?: string
}) {
  const views =
    current === undefined
      ? stack.map((view, index) => ({ label: crumbLabel(view, locale), index }))
      : [{ label: current, index: 0 }]
  const entries = [...(rootLabel !== undefined ? [{ label: rootLabel, index: -1 }] : []), ...views]
  if (entries.length <= 1) return null
  return (
    <nav
      aria-label={translator(locale, "cockpit.aria.breadcrumb")}
      className={cn(
        "text-muted-foreground text-dense flex min-w-0 flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {entries.map((entry, position) => (
        <span key={position} className="inline-flex items-center gap-1.5">
          {position > 0 && <Icon icon={ChevronRight} dense />}
          {position < entries.length - 1 ? (
            <button type="button" onClick={() => onPop(entry.index)} className={CRUMB}>
              {entry.label}
            </button>
          ) : (
            <span aria-current="page" className="text-foreground font-semibold">
              {entry.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}

/** "All engines", then the app-level view the cockpit shows; only where the chooser exists. */
function LandingCrumbs({
  current,
  locale,
  onLanding,
}: {
  current: string
  locale: string
  onLanding: () => void
}) {
  return (
    <nav
      aria-label={translator(locale, "cockpit.aria.breadcrumb")}
      className="text-muted-foreground text-dense flex items-center gap-1.5"
    >
      <button type="button" onClick={onLanding} className={CRUMB}>
        {translator(locale, "cockpit.crumb.allEngines")}
      </button>
      <Icon icon={ChevronRight} dense />
      <span aria-current="page" className="text-foreground font-semibold">
        {current}
      </span>
    </nav>
  )
}

/** Offered only with more than one engine, so the chooser is always there to go back to. */
export function FleetCrumbs({ locale, onLanding }: { locale: string; onLanding: () => void }) {
  return (
    <LandingCrumbs
      current={translator(locale, "cockpit.crumb.fleet")}
      locale={locale}
      onLanding={onLanding}
    />
  )
}

/**
 * A board's trail where the chooser shows (more than one engine, or one beside the server's
 * boards): the chooser, then the board by its title.
 */
export function BoardCrumbs({
  view,
  locale,
  onLanding,
}: {
  view: BoardView
  locale: string
  onLanding: () => void
}) {
  return <LandingCrumbs current={crumbLabel(view, locale)} locale={locale} onLanding={onLanding} />
}

/**
 * A key change is a navigation. An engine shown on boards only is named by `current`, its one
 * state's, never by the view its stack holds.
 */
export function navigationOf(
  scope: CockpitScope,
  stack: readonly CockpitView[],
  locale: string,
  current?: string,
): { key: string; label: string } {
  if (scope.kind === "landing") {
    return { key: "landing", label: translator(locale, "cockpit.landing.title") }
  }
  if (scope.kind === "fleet") {
    return { key: "fleet", label: translator(locale, "cockpit.crumb.fleet") }
  }
  if (scope.kind === "board") {
    return { key: viewKey(scope.view), label: crumbLabel(scope.view, locale) }
  }
  const view = stack[stack.length - 1]
  return {
    key: `${scope.engineId}|${stack.length}|${JSON.stringify(view)}`,
    label: current ?? (view ? crumbLabel(view, locale) : ""),
  }
}
