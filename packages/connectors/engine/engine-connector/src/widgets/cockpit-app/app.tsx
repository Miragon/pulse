import { useCallback, useMemo, type ReactNode } from "react"
import { EmptyState, NavigationFocus, useLocale, ViewBarSlots } from "@miragon/pulse-ui"
import {
  HostModelContext,
  useHostChrome,
  useHostDisplayMode,
  useStartPage,
  useToolQuery,
  ViewDataState,
  ViewErrorBoundary,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData, CockpitView } from "../../view-models.js"
import type { LandingStartData } from "../../view-models.board.js"
import { groupEnginesByEnvironment } from "../../lib/shared/environments.js"
import { NavProvider, type OnNavigate } from "../navigation.js"
import { type CockpitScope, viewKey } from "../nav-core.js"
import { useHandOff, type ViewContext } from "../lib/hand-off.js"
import {
  boardsOnlyEngineContext,
  cockpitContext,
  fleetContext,
  landingContext,
  refusedEngineContext,
} from "./model-context.js"
import { translator } from "../../messages/use-t.js"
import { ENGINE_LIST_ENGINES } from "../../tool-names.js"
import { BoardCrumbs, FleetCrumbs, navigationKeyOf } from "./breadcrumb.js"
import { startSeed, useCockpitState } from "./cockpit-state.js"
import { EngineBars, EngineGoneNotice } from "./engine-bars.js"
import { useProcessCheck } from "./engine-switch.js"
import { CockpitTrailBar } from "./head.js"
import { useAddressStart, usePlaceOnAddress } from "./place.js"
import {
  CockpitRefreshButton,
  CockpitRefreshProvider,
  CockpitRefreshRegion,
} from "./refresh-button.js"
import { CockpitRoute } from "./routes.js"
import { FleetView } from "./fleet-view.js"
import { LandingBar, LandingChooser, LandingHeader, type ServerBoards } from "./landing.js"
import { RefusedEngineGate, useProfileRefusal } from "./refused-engine.js"
import { BoardsOnlyEngineGate } from "./boards-only-engine.js"
import {
  type BoardsOnlyEngine,
  boardsOnlyOf,
  type CockpitEngine,
  dialectFactsOf,
  type ListedEngineFacts,
  readsWhole,
} from "./boards-only.js"

export type { CockpitAppData }

interface EnginesResult extends Partial<ServerBoards> {
  engines: Array<ListedEngineFacts & { environment?: string }>
  defaultEngineId: string | null
  /** Profiles the server refused, each with why: the picker lists them too, opening one says why. */
  refused?: Array<{ id: string; environment?: string; reason: string }>
}

type ListedEngine = CockpitEngine

/**
 * Every configured engine the list names, the refused ones too, in the order the start data gave
 * them (the profiles'), so no row moves when the list answers; one the start data does not name
 * comes last. Each with what the list says of its dialect, so a cockpit without start data shows
 * an engine of another dialect on boards only too.
 */
function listedEngines(result: EnginesResult, order: readonly ListedEngine[]): ListedEngine[] {
  const boards = result.boards ?? []
  const named = [
    ...result.engines.map((engine) => ({ engine, facts: dialectFactsOf(engine, boards) })),
    ...(result.refused ?? []).map((engine) => ({
      engine,
      facts: { refused: { reason: engine.reason } },
    })),
  ].map(({ engine: { id, environment }, facts }) => ({
    id,
    ...(environment === undefined ? {} : { environment }),
    ...facts,
  }))
  const rank = new Map(order.map(({ id }, index) => [id, index]))
  const place = (id: string) => rank.get(id) ?? rank.size
  return named.sort((a, b) => place(a.id) - place(b.id))
}

/**
 * The boards of ENGINE_BOARDS_DIR as the engine list names them (`boards` and `refusedBoards`
 * only with the directory set), or null while there is none: a server without boards keeps the
 * chooser to two engines and more.
 */
function serverBoards(result: Partial<ServerBoards> | undefined): ServerBoards | null {
  const boards = result?.boards ?? []
  const refusedBoards = result?.refusedBoards ?? []
  return boards.length + refusedBoards.length > 0 ? { boards, refusedBoards } : null
}

/**
 * The landing's start data (`engine_open_cockpit` view `landing`): the boards the engine list
 * names, as the tool read them, until the list answers. The landing has no feed of its own.
 */
function landingSeed(data: CockpitAppData | null): LandingStartData | undefined {
  const start = data?.start
  return start?.view.section === "landing" ? (start.data as LandingStartData) : undefined
}

/**
 * What the model hears of an open engine: its refused profile, its dialect the server reads on
 * boards only, or the view on screen.
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

/**
 * The engine the cockpit shows without a section, on boards only or as its refused profile: its one
 * state names it, never the view its stack holds.
 */
function sectionlessEngineIn(
  scope: CockpitScope,
  engines: readonly ListedEngine[],
  refused: boolean,
): string | undefined {
  if (scope.kind !== "engine") return undefined
  const engine = engines.find(({ id }) => id === scope.engineId)
  return refused || boardsOnlyOf(engine) !== null ? scope.engineId : undefined
}

/**
 * #322 U15: an empty engine list is the app-level "no engines" surface. On a page with chrome of
 * its own its title is the view bar's (`LandingBar`).
 */
function EnginesEmptyState({
  enginesQuery,
  chrome,
}: {
  enginesQuery: { isError: boolean; error: Error | null; data: unknown; refetch: () => unknown }
  chrome: boolean
}) {
  const locale = useLocale()
  const loading = !enginesQuery.isError && enginesQuery.data === undefined
  if (loading || enginesQuery.error) {
    return (
      <WidgetShell>
        <ViewDataState
          loading={loading}
          error={enginesQuery.error}
          loadingText={translator(locale, "cockpit.loading.engines")}
          emptyText={translator(locale, "cockpit.empty.engines")}
          onRetry={() => void enginesQuery.refetch()}
          retryLabel={translator(locale, "viewState.retry")}
        />
      </WidgetShell>
    )
  }
  return (
    <WidgetShell header={chrome && <LandingBar />}>
      <div className="gap-section flex flex-col">
        {!chrome && <LandingHeader />}
        <EmptyState
          titleAs="h2"
          title={translator(locale, "cockpit.empty.enginesTitle")}
          description={translator(locale, "cockpit.empty.engines")}
          className="border-border bg-card rounded-md border"
        />
      </div>
    </WidgetShell>
  )
}

/**
 * An app-level view (the cross-engine overview, a board): no engine's head, its trail on a row of
 * its own where it has one. On a page the bar's product is the way back to the chooser, so no
 * trail repeats it there.
 */
function AppScope({
  flush = false,
  page,
  trail,
  children,
}: {
  flush?: boolean
  /** A page whose bar leads to its start page (`useStartPage`). */
  page: boolean
  trail: ReactNode
  children: ReactNode
}) {
  const header = trail && !page ? <CockpitTrailBar>{trail}</CockpitTrailBar> : null
  return (
    <WidgetShell flush={flush} header={header}>
      {children}
    </WidgetShell>
  )
}

/**
 * The cockpit. On a page with chrome of its own (`useHostChrome`: the page's navigation holds the
 * sections, the engine switch and the view across engines) it leaves its head to the page: every
 * view bar shows the page's menu first, an engine's bar the cockpit's Refresh first among its
 * actions, an engine without sections a bar of its own (its name, the Refresh) over its one state,
 * and an app-level title is the bar's title. In a chat it keeps its head.
 */
export function CockpitApp({ data }: { data: CockpitAppData | null }) {
  const chrome = useHostChrome()
  const app = <CockpitScopes data={data} chrome={chrome !== undefined} />
  return chrome ? <ViewBarSlots lead={chrome.menu}>{app}</ViewBarSlots> : app
}

function CockpitScopes({ data, chrome }: { data: CockpitAppData | null; chrome: boolean }) {
  // Decoupled from the open_cockpit bootstrap so picker and switcher work however the app launched.
  const enginesQuery = useToolQuery<EnginesResult>(["engine:engines"], ENGINE_LIST_ENGINES, {})
  const listed = enginesQuery.data
  const bootEngines = data?.engines
  const engines = useMemo(
    () => (listed ? listedEngines(listed, bootEngines ?? []) : (bootEngines ?? [])),
    [listed, bootEngines],
  )
  const engineGroups = groupEnginesByEnvironment(engines)

  const locale = useLocale()
  const { context } = useHandOff()
  const inline = useHostDisplayMode() === "inline"
  // A page whose bar leads to its start page: the chooser's crumb is the bar's product there.
  const page = useStartPage() !== undefined
  // Where the page's address put the cockpit beyond its start view (the web app's fleet page).
  const addressStart = useAddressStart()

  const boards = serverBoards(listed ?? landingSeed(data))
  // Two engines need it to pick one; a single engine only when the server has boards to show.
  const chooser = engines.length > 1 || boards !== null
  const [state, dispatch] = useCockpitState(data, engines, boards !== null, addressStart)
  const { scope, stack, goneEngineId } = state
  // A read that met it since the list last answered (also before it answers, or where it fails),
  // else what the start data or the engine list names.
  const refusal = useProfileRefusal(
    scope.kind === "engine" ? scope.engineId : null,
    engines,
    enginesQuery.dataUpdatedAt,
  )

  // The cross-engine view reads every engine itself, so two it reads whole are all it needs; one
  // the server shows on boards only it names and leaves out.
  const fleetEngines = engines.filter(readsWhole)
  const offerFleet = fleetEngines.length > 1
  const openFleet = offerFleet ? () => dispatch({ type: "to-fleet" }) : undefined

  const enterEngine = (id: string) => dispatch({ type: "enter-engine", id })
  const toLanding = () => dispatch({ type: "to-landing" })
  // A board's drill opens a view of the cockpit only where its route reads the engine's dialect.
  const dialectOf = useCallback(
    (id: string) => engines.find((engine) => engine.id === id)?.dialect,
    [engines],
  )
  const openBoard = (board: string, title: string) =>
    dispatch({ type: "open-board", view: { section: "board", board, label: title } })

  const navigate: OnNavigate = dispatch
  // An engine shown without a section: its one state reads nothing, and names no route's place.
  const withoutSection = sectionlessEngineIn(scope, engines, refusal !== null) !== undefined
  // After an engine switch, whether the new engine deploys the process the view kept (N7).
  useProcessCheck(state, withoutSection, dispatch)
  // A page's address follows where the cockpit is (N1); a chat has none.
  const claimed = usePlaceOnAddress(state, withoutSection, refusal !== null, dispatch)

  // A place the page shows itself (its engine screen): the page takes over as it reads the report.
  if (claimed) return null

  // Bootstrap engines let us proceed when the engines query failed.
  if (engines.length === 0) {
    return <EnginesEmptyState enginesQuery={enginesQuery} chrome={chrome} />
  }

  // #344 N107: one frame, so navigation moves focus to the new view's heading.
  const navKey = navigationKeyOf(scope, stack)

  if (scope.kind === "landing") {
    return (
      <NavigationFocus viewKey={navKey}>
        {/* The model hears the picker as the picker: no engine is in scope. */}
        <HostModelContext
          content={context(
            landingContext(
              engineGroups,
              boards,
              engines.filter((engine) => !readsWhole(engine)).map((engine) => engine.id),
            ),
          )}
        >
          {null}
        </HostModelContext>
        <LandingChooser
          engines={engines}
          defaultEngineId={listed?.defaultEngineId}
          onEnterEngine={enterEngine}
          onOpenFleet={openFleet}
          boards={boards}
          onOpenBoard={openBoard}
          notice={<EngineGoneNotice engineId={goneEngineId} />}
        />
      </NavigationFocus>
    )
  }

  if (scope.kind === "fleet") {
    return (
      <NavigationFocus viewKey={navKey}>
        <AppScope
          flush={chrome}
          page={page}
          trail={<FleetCrumbs locale={locale} onLanding={toLanding} />}
        >
          <HostModelContext
            content={context(fleetContext(groupEnginesByEnvironment(fleetEngines)))}
          >
            {null}
          </HostModelContext>
          <FleetView engines={engines} onEnterEngine={enterEngine} />
        </AppScope>
      </NavigationFocus>
    )
  }

  if (scope.kind === "board") {
    return (
      <NavigationFocus viewKey={navKey}>
        {/* A board reads the engines it names: no engine's head, the chooser one crumb away
            where it shows (on a page, the bar's product). Its view says what the model sees of
            it. The view frame's main holds the cockpit: the route's region renders none. */}
        <AppScope
          flush
          page={page}
          trail={chooser && <BoardCrumbs view={scope.view} locale={locale} onLanding={toLanding} />}
        >
          <div className="min-w-0">
            <NavProvider value={navigate}>
              <ViewErrorBoundary resetKey={viewKey(scope.view)}>
                <CockpitRoute
                  view={scope.view}
                  engine={null}
                  seed={startSeed(data, state)}
                  dialectOf={dialectOf}
                />
              </ViewErrorBoundary>
            </NavProvider>
          </div>
        </AppScope>
      </NavigationFocus>
    )
  }

  const engineId = scope.engineId
  const current = stack[stack.length - 1]
  const boardsOnly = boardsOnlyOf(engines.find((engine) => engine.id === engineId))
  // On a page with chrome an engine without sections has a bar of its own, whose title is the h1.
  const stateTitle = chrome ? "h2" : "h1"

  return (
    <NavigationFocus viewKey={navKey}>
      <CockpitRefreshProvider>
        {/* Flush: each route is a view of its own, its bar from edge to edge, its content in
            the gutter (WidgetShell). */}
        <WidgetShell
          flush
          header={
            <EngineBars
              engineId={engineId}
              engines={engines}
              engineGroups={engineGroups}
              chooser={chooser}
              refused={refusal !== null}
              state={state}
              inline={inline}
              page={page}
              chrome={chrome}
              onOpenFleet={openFleet}
              dispatch={dispatch}
            />
          }
        >
          <HostModelContext
            content={context(engineContextOf(engineId, current, refusal !== null, boardsOnly))}
          >
            {null}
          </HostModelContext>
          <CockpitRefreshRegion>
            {/* On a page with chrome the head's Refresh is the first action of the route's bar. */}
            <ViewBarSlots actions={chrome ? <CockpitRefreshButton bar /> : undefined}>
              {/* Every view is a route of self-fetching widgets. The NavProvider is
            the client-side navigation seam: widgets call `useNav()`, which
            resolves to this in-app router instead of a chat follow-up. The head
            names the engine, so the views leave it out of their own meta line.
            A crashing view never takes the cockpit down, a refused engine shows once, and so
            does one the server shows on boards only. The view frame's main holds the cockpit,
            so the route renders no main of its own. The region is busy while the head's
            Refresh reads its feeds again. */}
              <NavProvider value={navigate}>
                <ViewErrorBoundary resetKey={viewKey(current)}>
                  <RefusedEngineGate refusal={refusal} titleAs={stateTitle}>
                    <BoardsOnlyEngineGate
                      engineId={engineId}
                      boardsOnly={boardsOnly}
                      boards={boards}
                      onOpenBoard={openBoard}
                      titleAs={stateTitle}
                    >
                      <CockpitRoute
                        view={current}
                        engine={engineId}
                        seed={startSeed(data, state)}
                      />
                    </BoardsOnlyEngineGate>
                  </RefusedEngineGate>
                </ViewErrorBoundary>
              </NavProvider>
            </ViewBarSlots>
          </CockpitRefreshRegion>
        </WidgetShell>
      </CockpitRefreshProvider>
    </NavigationFocus>
  )
}
