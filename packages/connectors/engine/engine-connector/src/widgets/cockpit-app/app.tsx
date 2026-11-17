import { useMemo, type Dispatch } from "react"
import { EmptyState, NavigationFocus, StatusStrip, useLocale } from "@miragon/pulse-ui"
import {
  HostModelContext,
  useHostDisplayMode,
  useToolQuery,
  ViewDataState,
  ViewErrorBoundary,
  WidgetShell,
} from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData, CockpitView } from "../../view-models.js"
import type { LandingStartData } from "../../view-models.board.js"
import { groupEnginesByEnvironment } from "../../lib/shared/environments.js"
import { environmentIn } from "../lib/engine-context.js"
import { NavProvider, type OnNavigate } from "../navigation.js"
import { type BoardView, crumbLabel, viewKey } from "../nav-core.js"
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
import { BoardCrumbs, FleetCrumbs, NavBreadcrumb, navigationOf } from "./breadcrumb.js"
import {
  activeSectionOf,
  type CockpitAction,
  type CockpitState,
  startSeed,
  useCockpitState,
} from "./cockpit-state.js"
import { CockpitHead, CockpitTrailBar, EngineSwitch } from "./head.js"
import { CockpitRoute } from "./routes.js"
import { FleetView } from "./fleet-view.js"
import { LandingChooser, LandingHeader, type ServerBoards } from "./landing.js"
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
  /** Profiles the server refused: the picker lists them too, and opening one says why. */
  refused?: Array<{ id: string; environment?: string }>
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
    ...(result.refused ?? []).map((engine) => ({ engine, facts: {} })),
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
 * The list names the engine's profile refused: its view is one state (`RefusedEngineGate`), as
 * when a read of it already met the refusal (`useProfileRefusal`).
 */
function isRefused(result: EnginesResult | undefined, engineId: string): boolean {
  return result?.refused?.some(({ id }) => id === engineId) ?? false
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

/** Docked under the head: the engine the view showed went away, and the view fell back. */
function EngineGoneNotice({ engineId }: { engineId: string | null }) {
  const locale = useLocale()
  if (!engineId) return null
  return (
    <StatusStrip tone="warning" title={translator(locale, "cockpit.engineGone", { engineId })} />
  )
}

/** #322 U15: an empty engine list is the app-level "no engines" surface. */
function EnginesEmptyState({
  enginesQuery,
}: {
  enginesQuery: { isError: boolean; error: Error | null; data: unknown; refetch: () => unknown }
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
    <WidgetShell>
      <div className="gap-section mx-auto flex w-full max-w-3xl flex-col">
        <LandingHeader />
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
 * The trail's first crumb: the board an engine's view was opened from leads back to it; else
 * "All engines" leads back to the chooser (#322 U15) where it shows: with more than one engine,
 * or with one when the server has boards.
 */
function rootCrumb(
  fromBoard: BoardView | null,
  chooser: boolean,
  locale: string,
): string | undefined {
  if (fromBoard) return crumbLabel(fromBoard, locale)
  return chooser ? translator(locale, "cockpit.crumb.allEngines") : undefined
}

/**
 * An engine's bars, from edge to edge above its route: the head (its sections, inline a drilled
 * view's trail in their place), the trail on a row of its own where fullscreen has room for both
 * and it has two crumbs, and the notice of an engine that went away.
 */
function EngineBars({
  engineId,
  engines,
  engineGroups,
  chooser,
  state,
  inline,
  onOpenFleet,
  dispatch,
}: {
  engineId: string
  engines: readonly ListedEngine[]
  engineGroups: Array<{ id: string; engines: Array<{ id: string }> }>
  /** The chooser shows: the trail's first crumb leads back to it. */
  chooser: boolean
  state: CockpitState
  inline: boolean
  onOpenFleet?: () => void
  dispatch: Dispatch<CockpitAction>
}) {
  const locale = useLocale()
  const { stack, goneEngineId, fromBoard } = state
  const rootLabel = rootCrumb(fromBoard, chooser, locale)
  const leave = fromBoard ? ({ type: "to-board" } as const) : ({ type: "to-landing" } as const)
  const trail = (
    <NavBreadcrumb
      stack={stack}
      locale={locale}
      rootLabel={rootLabel}
      onPop={(to) => dispatch(to < 0 ? leave : { type: "pop", to })}
    />
  )
  // Inline is a card (#396): a drilled view's trail takes the sections' row, a head section shows none.
  const drilled = stack.length > 1
  const crumbs = stack.length + (rootLabel === undefined ? 0 : 1)
  return (
    <>
      <CockpitHead
        activeSection={activeSectionOf(stack)}
        onSection={(intent) => dispatch(intent)}
        onOpenFleet={onOpenFleet}
        trail={inline && drilled ? trail : undefined}
        engineSwitch={
          <EngineSwitch
            engineId={engineId}
            environment={environmentIn(engines, engineId)}
            engineGroups={engineGroups}
            onSwitch={(id) => dispatch({ type: "switch-engine", id })}
          />
        }
      />
      {!inline && crumbs > 1 && <CockpitTrailBar>{trail}</CockpitTrailBar>}
      <EngineGoneNotice engineId={goneEngineId} />
    </>
  )
}

export function CockpitApp({ data }: { data: CockpitAppData | null }) {
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

  const boards = serverBoards(listed ?? landingSeed(data))
  // Two engines need it to pick one; a single engine only when the server has boards to show.
  const chooser = engines.length > 1 || boards !== null
  const [state, dispatch] = useCockpitState(data, engines, boards !== null)
  const { scope, stack, goneEngineId } = state
  // Also before the engine list answers, or when it fails: a read already met the refusal.
  const metRefusal = useProfileRefusal(scope.kind === "engine" ? scope.engineId : null)

  // The cross-engine view reads every engine itself, so two it reads whole are all it needs; one
  // the server shows on boards only it names and leaves out.
  const fleetEngines = engines.filter(readsWhole)
  const offerFleet = fleetEngines.length > 1
  const openFleet = offerFleet ? () => dispatch({ type: "to-fleet" }) : undefined

  const enterEngine = (id: string) => dispatch({ type: "enter-engine", id })
  const openBoard = (board: string, title: string) =>
    dispatch({ type: "open-board", view: { section: "board", board, label: title } })

  const navigate: OnNavigate = dispatch

  // Bootstrap engines let us proceed when the engines query failed.
  if (engines.length === 0) {
    return <EnginesEmptyState enginesQuery={enginesQuery} />
  }

  // #344 N107: one frame, so navigation moves focus to the new view.
  const nav = navigationOf(scope, stack, locale)

  if (scope.kind === "landing") {
    return (
      <NavigationFocus viewKey={nav.key} label={nav.label}>
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
          defaultEngineId={enginesQuery.data?.defaultEngineId ?? null}
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
      <NavigationFocus viewKey={nav.key} label={nav.label}>
        <WidgetShell
          header={
            <CockpitTrailBar>
              <FleetCrumbs locale={locale} onLanding={() => dispatch({ type: "to-landing" })} />
            </CockpitTrailBar>
          }
        >
          <HostModelContext
            content={context(fleetContext(groupEnginesByEnvironment(fleetEngines)))}
          >
            {null}
          </HostModelContext>
          <FleetView engines={engines} onEnterEngine={enterEngine} />
        </WidgetShell>
      </NavigationFocus>
    )
  }

  if (scope.kind === "board") {
    return (
      <NavigationFocus viewKey={nav.key} label={nav.label}>
        {/* A board reads the engines it names: no engine's head, the chooser one crumb away
            where it shows. Its view says what the model sees of it. */}
        <WidgetShell
          flush
          header={
            chooser && (
              <CockpitTrailBar>
                <BoardCrumbs
                  view={scope.view}
                  locale={locale}
                  onLanding={() => dispatch({ type: "to-landing" })}
                />
              </CockpitTrailBar>
            )
          }
        >
          {/* The view frame's main holds the cockpit: the route's region renders none of its own. */}
          <div className="min-w-0">
            <NavProvider value={navigate}>
              <ViewErrorBoundary resetKey={viewKey(scope.view)}>
                <CockpitRoute view={scope.view} engine={null} seed={startSeed(data, state)} />
              </ViewErrorBoundary>
            </NavProvider>
          </div>
        </WidgetShell>
      </NavigationFocus>
    )
  }

  const engineId = scope.engineId
  const current = stack[stack.length - 1]
  const boardsOnly = boardsOnlyOf(engines.find((engine) => engine.id === engineId))

  return (
    <NavigationFocus viewKey={nav.key} label={nav.label}>
      {/* Flush: each route is a view of its own, its bar from edge to edge, its content in the
          gutter (WidgetShell). */}
      <WidgetShell
        flush
        header={
          <EngineBars
            engineId={engineId}
            engines={engines}
            engineGroups={engineGroups}
            chooser={chooser}
            state={state}
            inline={inline}
            onOpenFleet={openFleet}
            dispatch={dispatch}
          />
        }
      >
        <HostModelContext
          content={context(engineContextOf(engineId, current, metRefusal, boardsOnly))}
        >
          {null}
        </HostModelContext>
        <div className="min-w-0">
          {/* Every view is a route of self-fetching widgets. The NavProvider is
            the client-side navigation seam: widgets call `useNav()`, which
            resolves to this in-app router instead of a chat follow-up. The head
            names the engine, so the views leave it out of their own meta line.
            A crashing view never takes the cockpit down, a refused engine shows once, and so
            does one the server shows on boards only. The view frame's main holds the cockpit,
            so the route renders no main of its own. */}
          <NavProvider value={navigate}>
            <ViewErrorBoundary resetKey={viewKey(current)}>
              <RefusedEngineGate
                engine={engineId}
                refused={metRefusal || isRefused(listed, engineId)}
              >
                <BoardsOnlyEngineGate
                  engineId={engineId}
                  boardsOnly={boardsOnly}
                  boards={boards}
                  onOpenBoard={openBoard}
                  onLanding={chooser ? () => dispatch({ type: "to-landing" }) : undefined}
                >
                  <CockpitRoute view={current} engine={engineId} seed={startSeed(data, state)} />
                </BoardsOnlyEngineGate>
              </RefusedEngineGate>
            </ViewErrorBoundary>
          </NavProvider>
        </div>
      </WidgetShell>
    </NavigationFocus>
  )
}
