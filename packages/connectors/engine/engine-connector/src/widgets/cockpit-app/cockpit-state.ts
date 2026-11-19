import { useReducer } from "react"
import { useResetOnChange } from "@miragon/pulse-ui"
import type {
  CockpitAppData,
  CockpitStart,
  CockpitView,
  IncidentDetailData,
  InstanceDetailData,
  ProcessIncidentsData,
} from "../../view-models.js"
import type { ClusterDetailData } from "../../view-models.health.js"
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
function isTopSection(
  view: CockpitView | undefined,
): view is CockpitView & { section: TopSection } {
  return (
    view?.section === "overview" ||
    view?.section === "incidents" ||
    (view?.section === "jobs" && !view.processDefinitionKey)
  )
}

/**
 * How a change of state goes into a page's history (`ViewLocation.report`): a move the reader made
 * adds an entry, one the cockpit made for them (a boot, a fallback, Back itself) or one inside the
 * same view (its focus) names the current entry anew.
 */
type Moved = "push" | "replace"

/** The process an engine switch kept that the new engine does not deploy: said until the next move. */
export interface ProcessGone {
  engineId: string
  process: string
}

/** `scope` alone decides which cockpit shows; `stack` is the real history, so "back" returns where the user came from. */
export interface CockpitState {
  scope: CockpitScope
  stack: CockpitView[]
  /** Said on screen until the next scope change. */
  goneEngineId: string | null
  /** Said on screen until the next move. */
  processGone: ProcessGone | null
  /**
   * The start view's key while the stack still shows the entry the boot created; the first
   * action that leaves it clears this, so a later visit reads live instead of the tool call's
   * snapshot (a garbage-collected cache entry would take the old seed as fresh data).
   */
  seededKey: string | null
  /** The board an engine's view was opened from: the trail's first crumb leads back to it. */
  fromBoard: BoardView | null
  moved: Moved
  /** An engine switch kept views a process key addresses: whether the engine deploys it is asked. */
  checkProcesses: boolean
}

/** What a page's history keeps of the cockpit to come back to it (`restore`): no notice, no seed. */
export type CockpitMemo = Pick<CockpitState, "scope" | "stack" | "fromBoard">

export type CockpitAction =
  | NavIntent
  | { type: "boot"; engineId: string | null; view: CockpitView | null }
  | { type: "enter-engine"; id: string }
  | { type: "switch-engine"; id: string }
  | { type: "process-gone"; engineId: string; processDefinitionKey: string }
  | { type: "processes-kept" }
  | { type: "to-fleet" }
  | { type: "to-landing" }
  | { type: "to-board" }
  | { type: "open-board"; view: BoardView }
  | { type: "pop"; to?: number }
  // Back or Forward on a page: where the entry leads, never seeded; `restore` as it was left.
  | { type: "go"; engineId: string; view: CockpitView | null }
  | { type: "restore"; memo: CockpitMemo }
  // The page's address led there (Back, Forward, its start): the current entry, never a new one.
  | { type: "arrive"; action: CockpitAction }
  | ({ type: "reconcile" } & ScopeFix)

const ROOT_VIEW: CockpitView = { section: "overview" }

/**
 * The head section a view sits under, as the trail shows it (N10): an incident and its cause's
 * incidents under Incidents, a process's jobs under Jobs, a process, its instances and an instance
 * under the overview.
 */
function parentOf(view: CockpitView): CockpitView {
  switch (view.section) {
    case "incident-detail":
    case "cluster-detail":
      return { section: "incidents" }
    case "jobs":
      return { section: "jobs" }
    default:
      return ROOT_VIEW
  }
}

/** A head section's view is the root; any other start sits under its head section, so the trail leads back. */
function startStack(view: CockpitView | null): CockpitView[] {
  if (!view) return [ROOT_VIEW]
  return isTopSection(view) ? [view] : [parentOf(view), view]
}

interface Boot {
  engineId: string | null
  view?: CockpitView | null
}

/** A board on its own: no engine of the cockpit is open, its view is the stack's one entry. */
function boardState(view: BoardView, seededKey: string | null, moved: Moved): CockpitState {
  return {
    scope: { kind: "board", view },
    stack: [view],
    goneEngineId: null,
    processGone: null,
    seededKey,
    fromBoard: null,
    moved,
    checkProcesses: false,
  }
}

/**
 * Opens on the bootstrap's resolved engine and start view (`engine_open_cockpit`), else the
 * chooser, which the landing's start view opens too: it is the cockpit's scope, never an entry of
 * the stack. With one engine and no boards the chooser gives way to that engine (`reconcileScope`).
 */
function initialState({ engineId, view = null }: Boot): CockpitState {
  if (view?.section === "board") return boardState(view, viewKey(view), "replace")
  if (view?.section === "landing") return initialState({ engineId: null })
  return {
    scope: engineId ? { kind: "engine", engineId } : { kind: "landing" },
    stack: startStack(view),
    goneEngineId: null,
    processGone: null,
    seededKey: engineId && view ? viewKey(view) : null,
    fromBoard: null,
    moved: "replace",
    checkProcesses: false,
  }
}

/** A move the reader made to `scope`: a new entry of the page's history, no seed, no notice. */
function movedTo(scope: CockpitScope, stack: CockpitView[] = [ROOT_VIEW]): CockpitState {
  return { ...initialState({ engineId: null }), scope, stack, moved: "push" }
}

/** The new stack, and the seed only while its top is still the seeded start view. */
function withStack(state: CockpitState, stack: CockpitView[]): CockpitState {
  const top = viewKey(stack[stack.length - 1])
  const stillSeeded = state.seededKey !== null && top === state.seededKey
  // Another focus of the same view names the entry anew; another view adds one.
  const same = top === viewKey(state.stack[state.stack.length - 1])
  return {
    ...state,
    stack,
    seededKey: stillSeeded ? state.seededKey : null,
    processGone: null,
    moved: same ? "replace" : "push",
    checkProcesses: false,
  }
}

/**
 * The jobs on screen take another scope (their segment: All, Without retries): a choice inside the
 * view, which names the current entry anew, so a page's address, its memo and Back keep the scope
 * the reader chose. The jobs of another process, or of none, are another view.
 */
function rescopesJobs(stack: readonly CockpitView[], view: CockpitView): boolean {
  const top = stack[stack.length - 1]
  return (
    view.section === "jobs" &&
    top?.section === "jobs" &&
    top.processDefinitionKey === view.processDefinitionKey
  )
}

/** The view on top in another scope, the entry named anew. */
function withScope(state: CockpitState, view: CockpitView): CockpitState {
  return { ...withStack(state, [...state.stack.slice(0, -1), view]), moved: "replace" }
}

/** The views an engine switch keeps beyond the head section: the ones a process key addresses. */
function isKeyed(view: CockpitView): boolean {
  return (
    view.section === "process-detail" ||
    view.section === "process-instances" ||
    view.section === "jobs"
  )
}

/**
 * What an engine switch keeps (N7): the head section, and below it the views a process key
 * addresses as far as the trail runs through them; a view of one instance, incident or cause holds
 * ids of the other engine, so the trail ends above it. A board's target keeps the overview.
 */
function switchedStack(stack: readonly CockpitView[]): CockpitView[] {
  const fromSection = isTopSection(stack[0])
  const head = fromSection ? stack[0] : ROOT_VIEW
  const below = fromSection ? stack.slice(1) : stack
  const end = below.findIndex((view) => !isKeyed(view))
  return [head, ...(end < 0 ? below : below.slice(0, end))]
}

/** The process keys of the views an engine switch keeps, which the new engine must deploy. */
export function keptProcessKeys(stack: readonly CockpitView[]): string[] {
  const keys = switchedStack(stack).flatMap((view) =>
    "processDefinitionKey" in view && view.processDefinitionKey ? [view.processDefinitionKey] : [],
  )
  return [...new Set(keys)]
}

/** The name the trail gives a process key (its process view's label), else the key. */
function processNameIn(stack: readonly CockpitView[], key: string): string {
  for (const view of stack) {
    if (view.section === "process-detail" && view.processDefinitionKey === key && view.label) {
      return view.label
    }
  }
  return key
}

/** The process the new engine does not deploy: the head section, said under the head. */
function withoutProcess(state: CockpitState, engineId: string, key: string): CockpitState {
  const { scope, stack } = state
  const holds = stack.some(
    (view) => "processDefinitionKey" in view && view.processDefinitionKey === key,
  )
  if (scope.kind !== "engine" || scope.engineId !== engineId || !holds) return state
  return {
    ...state,
    stack: [stack[0]],
    seededKey: null,
    processGone: { engineId, process: processNameIn(stack, key) },
    moved: "replace",
    checkProcesses: false,
  }
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
 * A board's tile opens a view of one of its engines; the trail leads back to the board, then names
 * the view (N10): no head section the reader never passed sits between them. Only the board's own
 * tiles and chips send it, so the scope it leaves is that board.
 */
function onBoardEngine(state: CockpitState, engine: string, view: CockpitView): CockpitState {
  return {
    ...movedTo({ kind: "engine", engineId: engine }, [view]),
    fromBoard: state.scope.kind === "board" ? state.scope.view : null,
  }
}

/** Back to the board an engine's view was opened from, where there is one. */
function backToBoard(state: CockpitState): CockpitState {
  return state.fromBoard ? boardState(state.fromBoard, null, "push") : state
}

type AddressAction = Extract<CockpitAction, { type: "boot" | "go" | "restore" | "arrive" }>

/** Where the host's data or the page's address leads: the entry the reader is on, never a new one. */
function isAddressAction(action: CockpitAction): action is AddressAction {
  const { type } = action
  return type === "boot" || type === "go" || type === "restore" || type === "arrive"
}

function addressMove(state: CockpitState, action: AddressAction): CockpitState {
  switch (action.type) {
    case "boot":
      return initialState(action)
    case "go":
      return { ...initialState(action), seededKey: null }
    case "restore":
      return { ...initialState({ engineId: null }), ...action.memo }
    case "arrive":
      return { ...cockpitReducer(state, action.action), moved: "replace" }
  }
}

export function cockpitReducer(state: CockpitState, action: CockpitAction): CockpitState {
  if (isAddressAction(action)) return addressMove(state, action)
  switch (action.type) {
    case "enter-engine":
      return movedTo({ kind: "engine", engineId: action.id })
    case "switch-engine":
      // The head section stays, and the views a process key addresses; ids of the engine it
      // leaves never reach the next.
      return {
        ...movedTo({ kind: "engine", engineId: action.id }, switchedStack(state.stack)),
        checkProcesses: keptProcessKeys(state.stack).length > 0,
      }
    case "process-gone":
      return withoutProcess(state, action.engineId, action.processDefinitionKey)
    case "processes-kept":
      return { ...state, checkProcesses: false }
    case "to-fleet":
      return movedTo({ kind: "fleet" })
    case "to-landing":
      return movedTo({ kind: "landing" })
    case "to-board":
      return backToBoard(state)
    case "open-board":
      return boardState(action.view, null, "push")
    case "reconcile":
      return {
        ...initialState({ engineId: null }),
        scope: action.scope,
        goneEngineId: action.gone,
      }
    case "pop":
      return withStack(state, popTo(state.stack, action.to))
    case "board-target":
      return onBoardEngine(state, action.engine, action.view)
    default: {
      const view = intentToView(action)
      if (rescopesJobs(state.stack, view)) return withScope(state, view)
      // Cockpit-only policy; the shared pushView never resets.
      return withStack(state, isTopSection(view) ? [view] : pushView(state.stack, view))
    }
  }
}

/** The head section the stack's root is, or none: a board's target sits under the board alone. */
export function activeSectionOf(stack: readonly CockpitView[]): TopSection | null {
  const root = stack[0]
  return isTopSection(root) ? root.section : null
}

/** Whether two states show the same: the scope, the trail and the board it leads back to. */
function samePlace(a: CockpitState, b: CockpitState): boolean {
  const shown = ({ scope, stack, fromBoard }: CockpitState) =>
    JSON.stringify({ scope, stack, fromBoard })
  return shown(a) === shown(b)
}

/** The whole view, not `viewKey`: that ignores the process detail's focus on purpose. */
function bootKey({ engineId, view }: Boot): string {
  return `${engineId ?? ""}|${view ? JSON.stringify(view) : ""}`
}

/**
 * The start view's crumb by the name its data knows (N6): a board's title, an instance's business
 * key, a process's name, the element of an incident or its cause; without one the crumb keeps the
 * id. A drill's label already names it.
 */
function labelOfStart({ view, data }: CockpitStart): string | null | undefined {
  switch (view.section) {
    case "board":
      return (data as BoardStartData).title
    case "instance-detail":
      return (data as InstanceDetailData).instance.businessKey
    case "process-detail":
      return (data as ProcessIncidentsData).processDefinitionName
    case "cluster-detail":
      return (data as ClusterDetailData).activityName
    case "incident-detail":
      return (data as IncidentDetailData).activityName
    default:
      return undefined
  }
}

/** The start view, named by its data; a page's start that failed opens its view without data. */
export function startViewOf(data: CockpitAppData | null): CockpitView | null {
  const start = data?.start
  if (!start) return data?.startView ?? null
  // A start whose data is left out (a test's) keeps its ids.
  const read: unknown = start.data
  const label = read === null ? undefined : labelOfStart(start)
  // Only a view with a crumb of its own names one (`labelOfStart`).
  return label ? ({ ...start.view, label } as CockpitView) : start.view
}

/**
 * Both in the render phase, so the chooser never flashes and a stale engine id never reaches a
 * query. `withBoards`: the engine list names a board or a board file, so the chooser shows with
 * one engine too. `start`: where the page's address put the cockpit beyond its start view (a page
 * path of its own), applied once over the first boot.
 */
export function useCockpitState(
  data: CockpitAppData | null,
  engines: ReadonlyArray<{ id: string }>,
  withBoards: boolean,
  start: CockpitAction | null = null,
) {
  const boot = { engineId: data?.engineId ?? null, view: startViewOf(data) }
  const [state, dispatch] = useReducer(cockpitReducer, boot, (first) => {
    const booted = initialState(first)
    if (!start) return booted
    const arrived = cockpitReducer(booted, { type: "arrive", action: start })
    // An address that names where the boot already opened keeps the boot's seed: an engine by its
    // id alone, which the landing's start opens on a server of that engine and no board.
    return samePlace(arrived, booted) ? booted : arrived
  })
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
