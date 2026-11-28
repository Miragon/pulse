import { ViewBarSlots } from "@miragon/pulse-ui"
import {
  HostModelContext,
  useHostDisplayMode,
  useStartPage,
  ViewErrorBoundary,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData, CockpitView } from "../../view-models.js"
import { groupEnginesByEnvironment } from "../../lib/shared/environments.js"
import { NavProvider } from "../navigation.js"
import { viewKey } from "../nav-core.js"
import { useHandOff, type ViewContext } from "../lib/hand-off.js"
import { boardsOnlyEngineContext, cockpitContext, refusedEngineContext } from "./model-context.js"
import { startSeed } from "./cockpit-state.js"
import { EngineBars } from "./engine-bars.js"
import {
  CockpitRefreshButton,
  CockpitRefreshProvider,
  CockpitRefreshRegion,
} from "./refresh-button.js"
import { CockpitRoute } from "./routes.js"
import { RefusedEngineGate } from "./refused-engine.js"
import { BoardsOnlyEngineGate } from "./boards-only-engine.js"
import { type BoardsOnlyEngine, boardsOnlyOf } from "./boards-only.js"
import type { Cockpit } from "./use-cockpit.js"

/**
 * What the model hears of an open engine: its refused profile, its dialect the chat's cockpit
 * shows on boards only, or the view on screen.
 */
function engineContextOf(
  engineId: string,
  current: CockpitView,
  refused: boolean,
  boardsOnly: BoardsOnlyEngine | null,
): ViewContext {
  if (refused) return refusedEngineContext(engineId)
  if (boardsOnly) return boardsOnlyEngineContext(engineId, boardsOnly)
  return cockpitContext(engineId, current)
}

interface EngineScopeProps {
  cockpit: Cockpit
  engineId: string
  data: CockpitAppData | null
  chrome: boolean
}

/**
 * The open engine's route under its bars. Every view is a route of self-fetching widgets. The
 * NavProvider is the client-side navigation seam: widgets call `useNav()`, which resolves to this
 * in-app router instead of a chat follow-up. The head names the engine, so the views leave it out
 * of their own meta line. A crashing view never takes the cockpit down, a refused engine shows
 * once, and so does one the chat's cockpit shows on boards only. The view frame's main holds the
 * cockpit, so the route renders no main of its own. The region is busy while the head's Refresh
 * reads its feeds again.
 */
function EngineRouteRegion({
  cockpit,
  engineId,
  data,
  chrome,
  current,
  boardsOnly,
}: EngineScopeProps & { current: CockpitView; boardsOnly: BoardsOnlyEngine | null }) {
  // On a page with chrome an engine without sections has a bar of its own, whose title is the h1.
  const stateTitle = chrome ? "h2" : "h1"
  return (
    <CockpitRefreshRegion>
      {/* On a page with chrome the head's Refresh is the first action of the route's bar. */}
      <ViewBarSlots actions={chrome ? <CockpitRefreshButton bar /> : undefined}>
        <NavProvider value={cockpit.dispatch}>
          <ViewErrorBoundary resetKey={viewKey(current)}>
            <RefusedEngineGate refusal={cockpit.refusal} titleAs={stateTitle}>
              <BoardsOnlyEngineGate
                engineId={engineId}
                boardsOnly={boardsOnly}
                boards={cockpit.boards}
                onOpenBoard={cockpit.moves.openBoard}
                titleAs={stateTitle}
              >
                <CockpitRoute
                  view={current}
                  engine={engineId}
                  seed={startSeed(data, cockpit.state)}
                />
              </BoardsOnlyEngineGate>
            </RefusedEngineGate>
          </ViewErrorBoundary>
        </NavProvider>
      </ViewBarSlots>
    </CockpitRefreshRegion>
  )
}

/** An engine's scope: its bars, what the model hears of it, and its route. */
export function EngineScope(props: EngineScopeProps) {
  const { cockpit, engineId, chrome } = props
  const { engines, state, refusal } = cockpit
  const { context } = useHandOff()
  const inline = useHostDisplayMode() === "inline"
  // A page whose bar leads to its start page: the chooser's crumb is the bar's product there.
  const page = useStartPage() !== undefined
  const current = state.stack[state.stack.length - 1]
  const boardsOnly = boardsOnlyOf(engines.find((engine) => engine.id === engineId))
  return (
    <CockpitRefreshProvider>
      {/* Flush: each route is a view of its own, its bar from edge to edge, its content in
          the gutter (WidgetShell). */}
      <WidgetShell
        flush
        header={
          <EngineBars
            engineId={engineId}
            engines={engines}
            engineGroups={groupEnginesByEnvironment(engines)}
            chooser={cockpit.chooser}
            refused={refusal !== null}
            state={state}
            inline={inline}
            page={page}
            chrome={chrome}
            onOpenFleet={cockpit.moves.openFleet}
            dispatch={cockpit.dispatch}
          />
        }
      >
        <HostModelContext
          content={context(engineContextOf(engineId, current, refusal !== null, boardsOnly))}
        >
          {null}
        </HostModelContext>
        <EngineRouteRegion {...props} current={current} boardsOnly={boardsOnly} />
      </WidgetShell>
    </CockpitRefreshProvider>
  )
}
