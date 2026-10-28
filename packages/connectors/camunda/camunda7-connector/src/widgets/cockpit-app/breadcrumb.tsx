import { FOCUS_RING, cn } from "@miragon/mcp-toolkit-ui"
import { Icon } from "@miragon/pulse-widget-shell/widgets"
import { ChevronRight } from "lucide-react"
import { translator } from "../../messages/index.js"
import { crumbLabel, type CockpitScope, type CockpitView } from "../nav-core.js"

/**
 * Every crumb pops back to the view it names, so back never re-drills from the top.
 * `rootLabel` adds a leading crumb that leaves the trail via `onPop(-1)`.
 */
export function NavBreadcrumb({
  stack,
  locale,
  onPop,
  rootLabel,
}: {
  stack: CockpitView[]
  locale: string
  onPop: (to: number) => void
  rootLabel?: string
}) {
  const entries = [
    ...(rootLabel !== undefined ? [{ label: rootLabel, index: -1 }] : []),
    ...stack.map((view, index) => ({ label: crumbLabel(view, locale), index })),
  ]
  if (entries.length <= 1) return null
  return (
    <nav
      aria-label={translator(locale, "cockpit.aria.breadcrumb")}
      className="text-muted-foreground text-dense mb-4 flex flex-wrap items-center gap-1.5"
    >
      {entries.map((entry, position) => (
        <span key={position} className="inline-flex items-center gap-1.5">
          {position > 0 && <Icon icon={ChevronRight} dense />}
          {position < entries.length - 1 ? (
            <button
              type="button"
              onClick={() => onPop(entry.index)}
              className={cn("hover:text-foreground rounded", FOCUS_RING)}
            >
              {entry.label}
            </button>
          ) : (
            <span aria-current="page" className="text-foreground font-medium">
              {entry.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  )
}

/** Offered only with more than one engine, so the chooser is always there to go back to. */
export function FleetCrumbs({ locale, onLanding }: { locale: string; onLanding: () => void }) {
  return (
    <nav
      aria-label={translator(locale, "cockpit.aria.breadcrumb")}
      className="text-muted-foreground text-dense mb-4 flex items-center gap-1.5"
    >
      <button
        type="button"
        onClick={onLanding}
        className={cn("hover:text-foreground rounded", FOCUS_RING)}
      >
        {translator(locale, "cockpit.crumb.allEngines")}
      </button>
      <Icon icon={ChevronRight} dense />
      <span aria-current="page" className="text-foreground font-medium">
        {translator(locale, "cockpit.crumb.fleet")}
      </span>
    </nav>
  )
}

/** A key change is a navigation. */
export function navigationOf(
  scope: CockpitScope,
  stack: readonly CockpitView[],
  locale: string,
): { key: string; label: string } {
  if (scope.kind === "landing") {
    return { key: "landing", label: translator(locale, "cockpit.landing.title") }
  }
  if (scope.kind === "fleet") {
    return { key: "fleet", label: translator(locale, "cockpit.crumb.fleet") }
  }
  const view = stack[stack.length - 1]
  return {
    key: `${scope.engineId}|${stack.length}|${JSON.stringify(view)}`,
    label: view ? crumbLabel(view, locale) : "",
  }
}
