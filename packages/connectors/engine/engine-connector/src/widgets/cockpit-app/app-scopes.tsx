import { useCallback, type ReactNode } from "react"
import { useLocale } from "@miragon/pulse-ui"
import {
  HostModelContext,
  useStartPage,
  ViewErrorBoundary,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData } from "../../view-models.js"
import { groupEnginesByEnvironment } from "../../lib/shared/environments.js"
import { NavProvider } from "../navigation.js"
import { type BoardView, viewKey } from "../nav-core.js"
import { useHandOff } from "../lib/hand-off.js"
import { fleetContext, landingContext } from "./model-context.js"
import { BoardCrumbs, FleetCrumbs } from "./breadcrumb.js"
import { startSeed } from "./cockpit-state.js"
import { EngineGoneNotice } from "./engine-bars.js"
import { CockpitTrailBar } from "./head.js"
import { CockpitRoute } from "./routes.js"
import { FleetView } from "./fleet-view.js"
import { LandingChooser } from "./landing.js"
import { readsWhole } from "./boards-only.js"
import type { Cockpit } from "./use-cockpit.js"

/**
 * An app-level view (the cross-engine overview, a board): no engine's head, its trail on a row of
 * its own where it has one. On a page the bar's product is the way back to the chooser, so no
 * trail repeats it there.
 */
function AppScope({
  flush = false,
  trail,
  children,
}: {
  flush?: boolean
  trail: ReactNode
  children: ReactNode
}) {
  // A page whose bar leads to its start page: the chooser's crumb is the bar's product there.
  const page = useStartPage() !== undefined
  const header = trail && !page ? <CockpitTrailBar>{trail}</CockpitTrailBar> : null
  return (
    <WidgetShell flush={flush} header={header}>
      {children}
    </WidgetShell>
  )
}

/** The chooser. The model hears the picker as the picker: no engine is in scope. */
export function LandingScope({ cockpit }: { cockpit: Cockpit }) {
  const { context } = useHandOff()
  const { engines, boards, moves } = cockpit
  return (
    <>
      <HostModelContext
        content={context(
          landingContext(
            groupEnginesByEnvironment(engines),
            boards,
            engines.filter((engine) => !readsWhole(engine)).map((engine) => engine.id),
          ),
        )}
      >
        {null}
      </HostModelContext>
      <LandingChooser
        engines={engines}
        defaultEngineId={cockpit.listed?.defaultEngineId}
        onEnterEngine={moves.enterEngine}
        onOpenFleet={moves.openFleet}
        boards={boards}
        onOpenBoard={moves.openBoard}
        notice={<EngineGoneNotice engineId={cockpit.state.goneEngineId} />}
      />
    </>
  )
}

/** The cross-engine overview, which the model hears over the engines it reads whole. */
export function FleetScope({ cockpit, chrome }: { cockpit: Cockpit; chrome: boolean }) {
  const locale = useLocale()
  const { context } = useHandOff()
  const { engines, moves } = cockpit
  return (
    <AppScope flush={chrome} trail={<FleetCrumbs locale={locale} onLanding={moves.toLanding} />}>
      <HostModelContext
        content={context(fleetContext(groupEnginesByEnvironment(engines.filter(readsWhole))))}
      >
        {null}
      </HostModelContext>
      <FleetView engines={engines} onEnterEngine={moves.enterEngine} />
    </AppScope>
  )
}

/**
 * A board reads the engines it names: no engine's head, the chooser one crumb away where it shows
 * (on a page, the bar's product). Its view says what the model sees of it. The view frame's main
 * holds the cockpit: the route's region renders none.
 */
export function BoardScope({
  cockpit,
  view,
  data,
}: {
  cockpit: Cockpit
  view: BoardView
  data: CockpitAppData | null
}) {
  const locale = useLocale()
  const { engines, chooser, moves } = cockpit
  // A board's drill opens a view of the cockpit only where its route reads the engine's dialect.
  const dialectOf = useCallback(
    (id: string) => engines.find((engine) => engine.id === id)?.dialect,
    [engines],
  )
  return (
    <AppScope
      flush
      trail={chooser && <BoardCrumbs view={view} locale={locale} onLanding={moves.toLanding} />}
    >
      <div className="min-w-0">
        <NavProvider value={cockpit.dispatch}>
          <ViewErrorBoundary resetKey={viewKey(view)}>
            <CockpitRoute
              view={view}
              engine={null}
              seed={startSeed(data, cockpit.state)}
              dialectOf={dialectOf}
            />
          </ViewErrorBoundary>
        </NavProvider>
      </div>
    </AppScope>
  )
}
