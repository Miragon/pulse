import { type Dispatch, useMemo } from "react"
import { useToolQuery } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitAppData } from "../../view-models.js"
import type { LandingStartData } from "../../view-models.board.js"
import { ENGINE_LIST_ENGINES } from "../../tool-names.js"
import type { CockpitScope } from "../nav-core.js"
import { type CockpitAction, type CockpitState, useCockpitState } from "./cockpit-state.js"
import { useProcessCheck } from "./engine-switch.js"
import { useAddressStart, usePlaceOnAddress } from "./place.js"
import type { ServerBoards } from "./landing.js"
import { useProfileRefusal } from "./refused-engine.js"
import {
  boardsOnlyOf,
  type CockpitEngine,
  dialectFactsOf,
  type ListedEngineFacts,
  readsWhole,
} from "./boards-only.js"

interface EnginesResult extends Partial<ServerBoards> {
  engines: Array<ListedEngineFacts & { environment?: string }>
  defaultEngineId: string | null
  /** Profiles the server refused, each with why: the picker lists them too, opening one says why. */
  refused?: Array<{ id: string; environment?: string; reason: string }>
}

/**
 * Every configured engine the list names, the refused ones too, in the order the start data gave
 * them (the profiles'), so no row moves when the list answers; one the start data does not name
 * comes last. Each with what the list says of its dialect, so a cockpit without start data shows
 * an engine of another dialect on boards only too.
 */
function listedEngines(result: EnginesResult, order: readonly CockpitEngine[]): CockpitEngine[] {
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
 * The engine the cockpit shows without a section, on boards only or as its refused profile: its one
 * state names it, never the view its stack holds.
 */
function sectionlessEngineIn(
  scope: CockpitScope,
  engines: readonly CockpitEngine[],
  refused: boolean,
): string | undefined {
  if (scope.kind !== "engine") return undefined
  const engine = engines.find(({ id }) => id === scope.engineId)
  return refused || boardsOnlyOf(engine) !== null ? scope.engineId : undefined
}

/** The cockpit's moves its scopes offer, each one action of its state. */
interface CockpitMoves {
  enterEngine: (id: string) => void
  toLanding: () => void
  /** Only where the cross-engine view has two engines to read. */
  openFleet: (() => void) | undefined
  openBoard: (board: string, title: string) => void
}

function cockpitMoves(
  engines: readonly CockpitEngine[],
  dispatch: Dispatch<CockpitAction>,
): CockpitMoves {
  // The cross-engine view reads every engine itself, so two it reads whole are all it needs; one
  // the server shows on boards only it names and leaves out.
  const offerFleet = engines.filter(readsWhole).length > 1
  return {
    enterEngine: (id) => dispatch({ type: "enter-engine", id }),
    toLanding: () => dispatch({ type: "to-landing" }),
    openFleet: offerFleet ? () => dispatch({ type: "to-fleet" }) : undefined,
    openBoard: (board, title) =>
      dispatch({ type: "open-board", view: { section: "board", board, label: title } }),
  }
}

/** Where the cockpit is and what it shows there, as its scopes read it. */
export interface Cockpit {
  enginesQuery: ReturnType<typeof useToolQuery<EnginesResult>>
  /** The engine list's answer: undefined until the list answers. */
  listed: EnginesResult | undefined
  engines: CockpitEngine[]
  boards: ServerBoards | null
  /** Two engines need it to pick one; a single engine only when the server has boards to show. */
  chooser: boolean
  state: CockpitState
  dispatch: Dispatch<CockpitAction>
  /** The open engine's refused profile (`useProfileRefusal`), else null. */
  refusal: Error | null
  /** The page shows the place the cockpit is at itself (`usePlaceOnAddress`). */
  claimed: boolean
  moves: CockpitMoves
}

/**
 * The cockpit's engines and state: the engine list in the start data's order, the boards it
 * names, where the cockpit is, the open engine's refusal, and the page's address following it.
 */
export function useCockpit(data: CockpitAppData | null): Cockpit {
  // Decoupled from the open_cockpit bootstrap so picker and switcher work however the app launched.
  const enginesQuery = useToolQuery<EnginesResult>(["engine:engines"], ENGINE_LIST_ENGINES, {})
  const listed = enginesQuery.data
  const bootEngines = data?.engines
  const engines = useMemo(
    () => (listed ? listedEngines(listed, bootEngines ?? []) : (bootEngines ?? [])),
    [listed, bootEngines],
  )
  // Where the page's address put the cockpit beyond its start view (an engine named alone).
  const addressStart = useAddressStart()
  const boards = serverBoards(listed ?? landingSeed(data))
  const [state, dispatch] = useCockpitState(data, engines, boards !== null, addressStart)
  const { scope } = state
  // A read that met it since the list last answered (also before it answers, or where it fails),
  // else what the start data or the engine list names.
  const refusal = useProfileRefusal(
    scope.kind === "engine" ? scope.engineId : null,
    engines,
    enginesQuery.dataUpdatedAt,
  )
  // An engine shown without a section: its one state reads nothing, and names no route's place.
  const withoutSection = sectionlessEngineIn(scope, engines, refusal !== null) !== undefined
  // After an engine switch, whether the new engine deploys the process the view kept (N7).
  useProcessCheck(state, withoutSection, dispatch)
  // A page's address follows where the cockpit is (N1); a chat has none.
  const claimed = usePlaceOnAddress(state, withoutSection, refusal !== null, dispatch)
  const chooser = engines.length > 1 || boards !== null
  const moves = cockpitMoves(engines, dispatch)
  return {
    enginesQuery,
    listed,
    engines,
    boards,
    chooser,
    state,
    dispatch,
    refusal,
    claimed,
    moves,
  }
}
