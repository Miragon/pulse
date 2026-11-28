import { useEffect, useMemo, useRef, type Dispatch } from "react"
import { useHostLocation, type ViewPlace } from "@miragon/pulse-widget-shell/widgets"
import type { CockpitSection, CockpitView } from "../../view-models.js"
import { ROUTE_DIALECTS } from "../../view-models.dialects.js"
import type { CockpitAction, CockpitMemo, CockpitState } from "./cockpit-state.js"

/**
 * The cockpit's place on a page (N1): where it is, as `engine_open_cockpit`'s arguments, which a
 * page's address names (`ViewLocation`). A view of one engine is its route's `view`, the `engine`
 * and the ids the route takes (`COCKPIT_ROUTES`' `needs` and `takes`, which are the fields of its
 * `CockpitView`); a board is `view: "board"` with its id, the chooser `view: "landing"`. The
 * cross-engine overview is no view of the tool: its place is `view: "fleet"`, which a page reads
 * back to it; the web app claims it and the chooser's place, where its own start page shows every
 * engine side by side.
 */
export const FLEET_PLACE = "fleet"

/** A view's fields as the tool's arguments: everything but its section and its crumb's label. */
function idsOf(view: CockpitView): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(view).filter(
      ([field, value]) => field !== "section" && field !== "label" && value !== undefined,
    ),
  )
}

/** The place of `view`, a view of one engine, as the tool's arguments. */
export function engineViewArgs(engineId: string, view: CockpitView): Record<string, unknown> {
  return { view: view.section, engine: engineId, ...idsOf(view) }
}

/**
 * Where the cockpit is. An engine without sections (one the chat's cockpit shows on boards only, or
 * whose profile the server refused) is named by its id alone, never as a route that refuses it:
 * the web app starts such an address on the landing, which every server's tool takes (on a server
 * of Camunda 8 clusters alone it takes no `engine`), and the place leads on to the engine's one
 * state (the entry's memo, a page's start).
 */
export function placeArgsOf(state: CockpitState, sectionless: boolean): Record<string, unknown> {
  const { scope, stack } = state
  switch (scope.kind) {
    case "landing":
      return { view: "landing" }
    case "fleet":
      return { view: FLEET_PLACE }
    case "board":
      return { view: "board", board: scope.view.board }
    case "engine": {
      if (sectionless) return { engine: scope.engineId }
      return engineViewArgs(scope.engineId, stack[stack.length - 1])
    }
  }
}

/** One text per place, whatever the order of its arguments and whether the address typed them. */
export function placeKey(args: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.keys(args)
      .sort()
      .map((key) => [key, String(args[key])]),
  )
}

/** What a page's history keeps with an entry: its place, and the cockpit as it was left there. */
interface PlaceMemo {
  place: string
  cockpit: CockpitMemo
}

function memoOf(place: string, { scope, stack, fromBoard }: CockpitState): PlaceMemo {
  return { place, cockpit: { scope, stack, fromBoard } }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const SCOPES: ReadonlySet<unknown> = new Set(["landing", "fleet", "board", "engine"])

/** A view the cockpit has: an object of a section it knows. */
function isView(value: unknown): value is CockpitView {
  return (
    isRecord(value) &&
    typeof value.section === "string" &&
    Object.hasOwn(ROUTE_DIALECTS, value.section)
  )
}

/**
 * The memo of an entry, if it is one for `place`: the entry keeps it as the cockpit left it, but a
 * page's history outlives a build, so its shape is checked, and it never names another place than
 * the address.
 */
function memoFor(memo: unknown, place: string): CockpitMemo | null {
  if (!isRecord(memo) || memo.place !== place || !isRecord(memo.cockpit)) return null
  const { scope, stack, fromBoard } = memo.cockpit
  if (!isRecord(scope) || !SCOPES.has(scope.kind)) return null
  if (!Array.isArray(stack) || stack.length === 0 || !stack.every(isView)) return null
  if (fromBoard !== null && !isView(fromBoard)) return null
  return memo.cockpit as unknown as CockpitMemo
}

/** A section of a route of one engine, as a place's `view` names it. */
function isEngineSection(view: unknown): view is CockpitSection {
  return (
    typeof view === "string" &&
    Object.hasOwn(ROUTE_DIALECTS, view) &&
    view !== "board" &&
    view !== "landing"
  )
}

/**
 * Where a place leads the cockpit: back as it was left where the entry's memo says so, else to the
 * place itself (an address typed or shared). Null for a place the cockpit cannot go to itself
 * (a view it does not have): the page then loads the address anew, and the server says why.
 */
export function actionOfPlace(place: ViewPlace): CockpitAction | null {
  const { args } = place
  const memo = memoFor(place.memo, placeKey(args))
  if (memo) return { type: "restore", memo }
  const { view, engine, board, ...ids } = args
  if (view === FLEET_PLACE) return { type: "to-fleet" }
  if (view === "landing" || (view === undefined && engine === undefined)) {
    return { type: "to-landing" }
  }
  if (view === "board") {
    return typeof board === "string"
      ? { type: "open-board", view: { section: "board", board } }
      : null
  }
  if (typeof engine !== "string" || engine === "") return null
  if (view === undefined) return { type: "go", engineId: engine, view: null }
  if (!isEngineSection(view)) return null
  return { type: "go", engineId: engine, view: { ...ids, section: view } as CockpitView }
}

/**
 * Where the page's address put the cockpit at its start beyond the view tool's arguments (an engine
 * the web app's address names alone, which it starts on the landing), or null: applied once over
 * the first boot.
 */
export function useAddressStart(): CockpitAction | null {
  const start = useHostLocation()?.start
  return start ? actionOfPlace(start) : null
}

/**
 * The cockpit's moves on a page's address: each place it reaches goes into the page's history as
 * the move went (`CockpitState.moved`: a drill adds an entry, a fallback or another focus names the
 * current one), the first one names the entry the page opened on; Back and Forward lead the
 * cockpit back to their entry's place, never to one the page shows itself (`ViewLocation.claims`).
 * Answers whether the page claims the place the cockpit is at: the cockpit then renders nothing,
 * since the page takes over there. A chat has no address: nothing happens there, and it claims
 * nothing. An engine without sections (`sectionless`) is named alone, unless the page shows its
 * place itself, whole (a Camunda 8 engine's on the web app's screens): the cockpit then names the
 * place, which the page claims, so the page shows it. A refused profile (`refused`) is named alone
 * always.
 */
export function usePlaceOnAddress(
  state: CockpitState,
  sectionless: boolean,
  refused: boolean,
  dispatch: Dispatch<CockpitAction>,
): boolean {
  const location = useHostLocation()
  const args = useMemo(() => {
    const whole = placeArgsOf(state, false)
    return sectionless && (refused || !location?.claims?.(whole)) ? placeArgsOf(state, true) : whole
  }, [state, sectionless, refused, location])
  const place = placeKey(args)
  const memo = useMemo(() => memoOf(place, state), [place, state])
  const reported = useRef<{ place: string; memo: string } | null>(null)
  const { moved } = state
  useEffect(() => {
    if (!location) return
    const memoText = JSON.stringify(memo)
    const last = reported.current
    if (last?.place === place && last.memo === memoText) return
    // The first place and a new record of the same place name the current entry.
    const entry = last === null || last.place === place ? "replace" : moved
    reported.current = { place, memo: memoText }
    location.report({ args, memo }, entry)
  }, [location, args, memo, place, moved])
  useEffect(
    () =>
      location?.subscribe((next) => {
        const action = location.claims?.(next.args) === true ? null : actionOfPlace(next)
        if (action === null) return false
        dispatch({ type: "arrive", action })
        return true
      }),
    [location, dispatch],
  )
  return location?.claims?.(args) === true
}
