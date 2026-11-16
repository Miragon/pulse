import { useReducer } from "react"
import { useResetOnChange } from "@miragon/pulse-ui"
import type { CockpitAppData, CockpitStart, CockpitView } from "../../view-models.js"
import type { BoardStartData } from "../../view-models.board.js"
import type { NavIntent } from "../navigation.js"
import {
  type BoardView,
  type CockpitScope,
  intentToView,
  popTo,
  pushView,
  viewKey,
} from "../nav-core.js"
import type { TopSection } from "./head.js"

/** A head section's own view; the jobs of one process are a drill, not the head section. */
function isTopSection(view: CockpitView): view is CockpitView & { section: TopSection } {
  return (
    view.section === "overview" ||
    view.section === "incidents" ||
    (view.section === "jobs" && !view.processDefinitionKey)
  )
}

/** `scope` alone decides which cockpit shows; `stack` is the real history, so "back" returns where the user came from. */
export interface CockpitState {
  scope: CockpitScope
  stack: CockpitView[]
  /** Said on screen until the next scope change. */
  goneEngineId: string | null
  /**
   * The start view's key while the stack still shows the entry the boot created; the first
   * action that leaves it clears this, so a later visit reads live instead of the tool call's
   * snapshot (a garbage-collected cache entry would take the old seed as fresh data).
   */
  seededKey: string | null
  /** The board an engine's view was opened from: the trail's first crumb leads back to it. */
  fromBoard: BoardView | null
}

export type CockpitAction =
  | NavIntent
  | { type: "boot"; engineId: string | null; view: CockpitView | null }
  | { type: "enter-engine"; id: string }
  | { type: "switch-engine"; id: string }
  | { type: "to-fleet" }
  | { type: "to-landing" }
  | { type: "to-board" }
  | { type: "open-board"; view: BoardView }
  | { type: "pop"; to?: number }
  | ({ type: "reconcile" } & ScopeFix)

const ROOT_STACK: CockpitView[] = [{ section: "overview" }]

/** A head section's view is the root; any other start sits on the overview, so the trail leads back. */
function startStack(view: CockpitView | null): CockpitView[] {
  if (!view) return ROOT_STACK
  return isTopSection(view) ? [view] : [{ section: "overview" }, view]
}

interface Boot {
  engineId: string | null
  view?: CockpitView | null
}

/** A board on its own: no engine of the cockpit is open, its view is the stack's one entry. */
function boardState(view: BoardView, seededKey: string | null): CockpitState {
  return {
    scope: { kind: "board", view },
    stack: [view],
    goneEngineId: null,
    seededKey,
    fromBoard: null,
  }
}

/**
 * Opens on the bootstrap's resolved engine and start view (`engine_open_cockpit`), else the
 * chooser, which the landing's start view opens too: it is the cockpit's scope, never an entry of
 * the stack. With one engine and no boards the chooser gives way to that engine (`reconcileScope`).
 */
function initialState({ engineId, view = null }: Boot): CockpitState {
  if (view?.section === "board") return boardState(view, viewKey(view))
  if (view?.section === "landing") return initialState({ engineId: null })
  return {
    scope: engineId ? { kind: "engine", engineId } : { kind: "landing" },
    stack: startStack(view),
    goneEngineId: null,
    seededKey: engineId && view ? viewKey(view) : null,
    fromBoard: null,
  }
}

/** The new stack, and the seed only while its top is still the seeded start view. */
function withStack(state: CockpitState, stack: CockpitView[]): CockpitState {
  const stillSeeded =
    state.seededKey !== null && viewKey(stack[stack.length - 1]) === state.seededKey
  return { ...state, stack, seededKey: stillSeeded ? state.seededKey : null }
}

interface ScopeFix {
  scope: CockpitScope
  gone: string | null
}

/**
 * The engine list reloads (a racing bootstrap or a restarted server): a gone engine
 * falls back explicitly instead of querying a stale id. The chooser shows with two engines, or
 * with one when the server has boards, which it lists; the fleet needs two engines; a board reads
 * the engines it names, whatever the list holds. Without the chooser the sole engine opens.
 */
function reconcileScope(
  scope: CockpitScope,
  engineIds: readonly string[],
  withBoards: boolean,
): ScopeFix | null {
  if (engineIds.length === 0 || scope.kind === "board") return null
  const chooser = engineIds.length > 1 || withBoards
  const fallback: CockpitScope = chooser
    ? { kind: "landing" }
    : { kind: "engine", engineId: engineIds[0] }
  if (scope.kind === "engine") {
    return engineIds.includes(scope.engineId) ? null : { scope: fallback, gone: scope.engineId }
  }
  const stays = scope.kind === "fleet" ? engineIds.length > 1 : chooser
  return stays ? null : { scope: fallback, gone: null }
}

/**
 * A board's tile opens a view of one of its engines; the trail leads back to the board. Only the
 * board's own tiles and chips send it, so the scope it leaves is that board.
 */
function onBoardEngine(state: CockpitState, engine: string, view: CockpitView): CockpitState {
  return {
    scope: { kind: "engine", engineId: engine },
    stack: startStack(view),
    goneEngineId: null,
    seededKey: null,
    fromBoard: state.scope.kind === "board" ? state.scope.view : null,
  }
}

function cockpitReducer(state: CockpitState, action: CockpitAction): CockpitState {
  switch (action.type) {
    case "boot":
      return initialState(action)
    case "enter-engine":
    case "switch-engine":
      // Drill state carried over would resolve ids of another engine.
      return initialState({ engineId: action.id })
    case "to-fleet":
      return { ...initialState({ engineId: null }), scope: { kind: "fleet" } }
    case "to-landing":
      return initialState({ engineId: null })
    case "to-board":
      return state.fromBoard ? boardState(state.fromBoard, null) : state
    case "open-board":
      return boardState(action.view, null)
    case "reconcile":
      return { ...initialState({ engineId: null }), scope: action.scope, goneEngineId: action.gone }
    case "pop":
      return withStack(state, popTo(state.stack, action.to))
    case "board-target":
      return onBoardEngine(state, action.engine, action.view)
    default: {
      const view = intentToView(action)
      // Cockpit-only policy; the shared pushView never resets.
      return withStack(state, isTopSection(view) ? [view] : pushView(state.stack, view))
    }
  }
}

export function activeSectionOf(stack: CockpitView[]): TopSection {
  const root = stack[0]
  return isTopSection(root) ? root.section : "overview"
}

/** The whole view, not `viewKey`: that ignores the process detail's focus on purpose. */
function bootKey({ engineId, view }: Boot): string {
  return `${engineId ?? ""}|${view ? JSON.stringify(view) : ""}`
}

/** The start view, a board's named by its title, so its crumb reads as the board. */
function bootView(start: CockpitStart | null | undefined): CockpitView | null {
  if (!start) return null
  if (start.view.section !== "board") return start.view
  return { ...start.view, label: (start.data as BoardStartData).title }
}

/**
 * Both in the render phase, so the chooser never flashes and a stale engine id never reaches a
 * query. `withBoards`: the engine list names a board or a board file, so the chooser shows with
 * one engine too.
 */
export function useCockpitState(
  data: CockpitAppData | null,
  engines: ReadonlyArray<{ id: string }>,
  withBoards: boolean,
) {
  const boot = { engineId: data?.engineId ?? null, view: bootView(data?.start) }
  const [state, dispatch] = useReducer(cockpitReducer, boot, initialState)
  // A re-delivered bootstrap (another engine, start view or focus) opens where it names.
  useResetOnChange(bootKey(boot), () => dispatch({ type: "boot", ...boot }))
  const scopeFix = reconcileScope(
    state.scope,
    engines.map((e) => e.id),
    withBoards,
  )
  if (scopeFix) dispatch({ type: "reconcile", ...scopeFix })
  return [state, dispatch] as const
}

/** Where the boot's start view shows: its engine, or the board it opened on. */
function showsStart(data: CockpitAppData, scope: CockpitScope): boolean {
  if (scope.kind === "board") return true
  return scope.kind === "engine" && scope.engineId === data.engineId
}

/** The start view's data while the stack still shows the entry the boot seeded; else nothing. */
export function startSeed(
  data: CockpitAppData | null,
  { scope, stack, seededKey }: CockpitState,
): CockpitStart | null {
  if (!data?.start || seededKey === null || !showsStart(data, scope)) return null
  return viewKey(stack[stack.length - 1]) === seededKey ? data.start : null
}
