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
 * `nameOf` names a view the page shows itself by the page's word (`ViewLocation.nameOf`).
 */
export function NavBreadcrumb({
  stack,
  locale,
  onPop,
  rootLabel,
  current,
  nameOf,
  className,
}: {
  stack: CockpitView[]
  locale: string
  onPop: (to: number) => void
  rootLabel?: string
  current?: string
  nameOf?: (view: CockpitView) => string | undefined
  className?: string
}) {
  const views =
    current === undefined
      ? stack.map((view, index) => ({
          label: nameOf?.(view) ?? crumbLabel(view, locale),
          index,
        }))
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
 * A view as a navigation names it: the jobs' scope is their segment's, a choice inside the view,
 * so the segment the reader just checked keeps focus.
 */
function navigatedView(view: CockpitView | undefined): CockpitView | undefined {
  return view?.section === "jobs" ? { ...view, failedOnly: undefined } : view
}

/**
 * A key change is a navigation, which moves focus to the new view's heading (`NavigationFocus`):
 * the view's own `h1` names it, so no crumb's words are read in its place.
 */
export function navigationKeyOf(scope: CockpitScope, stack: readonly CockpitView[]): string {
  if (scope.kind === "landing" || scope.kind === "fleet") return scope.kind
  if (scope.kind === "board") return viewKey(scope.view)
  return `${scope.engineId}|${stack.length}|${JSON.stringify(navigatedView(stack[stack.length - 1]))}`
}
