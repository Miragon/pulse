import {
  isSignedOutReason,
  WEB_PATHS,
  WEB_QUERY,
  type SignedOutReason,
} from "@miragon/pulse-widget-shell/widgets"
import { PAGES } from "./pages.js"

/** The engine module's view, the cockpit: every page of the app opens it at a start of its own. */
export const COCKPIT_VIEW = "engine_open_cockpit"

/**
 * The cockpit's place of the cross-engine overview (its `view: "fleet"`), which no argument of the
 * tool names: its page starts the landing, then the cockpit opens it.
 */
const FLEET_PLACE = { view: "fleet" } as const

/** The landing's start: `/app`, the cross-engine overview's page and an engine named alone. */
const LANDING_ARGS = { view: "landing" } as const

/**
 * The cockpit's arguments that take no text: a query's `true` or `false` is their value. The tool's
 * input schema decides which (test/cockpit-flags.test.ts holds this list to it).
 */
const COCKPIT_FLAGS: ReadonlySet<string> = new Set(["failedOnly"])

/**
 * What a page's document title names before its view shows its heading, which then names it: the
 * product, or a board by its id (its title comes with the view).
 */
export type PageTitle =
  { readonly kind: "product" } | { readonly kind: "board"; readonly board: string }

/**
 * Where a page's location leads: a view with its view tool's arguments and its document title, or
 * the signed-out page. `place` is where the address puts the view beyond its arguments (the
 * cross-engine overview's page, an engine the cockpit's query names alone: both start the
 * landing), in the arguments' shape; absent where the arguments name it all.
 */
export type PageRoute =
  | {
      readonly kind: "view"
      readonly view: string
      readonly args: Readonly<Record<string, unknown>>
      readonly title: PageTitle
      readonly place?: Readonly<Record<string, unknown>>
    }
  | { readonly kind: "signed-out"; readonly reason: SignedOutReason }

/** The parts of the page's URL a route reads. */
export interface PageLocation {
  readonly pathname: string
  readonly search: string
}

const isFlag = (key: string, value: string): boolean =>
  COCKPIT_FLAGS.has(key) && (value === "true" || value === "false")

/**
 * The cockpit's arguments from the query, one per parameter, as `engine_open_cockpit` takes them
 * (`view`, `engine` and the ids its start view needs). The tool refuses a parameter it does not
 * know, and the page shows why: no parameter is dropped unseen.
 */
function cockpitArgs(search: string): Record<string, unknown> {
  return Object.fromEntries(
    [...new URLSearchParams(search)].map(([key, value]) => [
      key,
      isFlag(key, value) ? value === "true" : value,
    ]),
  )
}

/** Where a board's page starts: `/app/boards/` and one segment after it, the board's id. */
const BOARD_PREFIX = PAGES.board.slice(0, PAGES.board.lastIndexOf("/") + 1)

/** A segment of the path as its text: the browser escapes it, a broken escape stays as sent. */
function segmentText(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** The board a board's page names, or undefined on any other path. */
function boardOf(pathname: string): string | undefined {
  if (!pathname.startsWith(BOARD_PREFIX)) return undefined
  const segment = pathname.slice(BOARD_PREFIX.length)
  return segment === "" || segment.includes("/") ? undefined : segmentText(segment)
}

type ViewRoute = Extract<PageRoute, { kind: "view" }>

const cockpitAt = (args: Record<string, unknown>, title: PageTitle): ViewRoute => ({
  kind: "view",
  view: COCKPIT_VIEW,
  args,
  title,
})

/**
 * The cockpit's start from the query of `/app/cockpit`. An engine the query names alone (its one
 * parameter, the place the cockpit writes for an engine without sections: one shown on boards only,
 * a refused profile) starts the landing, as the cross-engine overview's page does, and the cockpit
 * opens that engine as its place: the tool takes no `engine` on a server of Camunda 8 clusters
 * alone, and the landing opens on every server (with one engine and no board the tool opens that
 * engine, and the cockpit keeps its start). Any other query is the tool's arguments.
 */
function cockpitStart(search: string, title: PageTitle): ViewRoute {
  const args = cockpitArgs(search)
  const engineAlone = Object.keys(args).join() === "engine" // the one parameter
  return engineAlone ? { ...cockpitAt(LANDING_ARGS, title), place: args } : cockpitAt(args, title)
}

/**
 * The route a location opens. `/app` is the cockpit's landing: the engines and the server's
 * boards, with one engine too where the server has boards (with one engine and none, the cockpit
 * opens that engine). `/app/fleet` starts there too and opens the cross-engine overview. A board's
 * page opens the cockpit's board view by its id, which the tool refuses where the server shows no
 * such board, and the page says why. The signed-out page reads its reason, the one of a sign-out
 * where the query names none (the identity provider's way back after a sign-out names none). The
 * address follows the cockpit as the reader moves on (`urlOf`), so every place it writes opens
 * here again on every server, an engine named alone too (`cockpitStart`).
 */
export function routeOf({ pathname, search }: PageLocation): PageRoute {
  if (pathname === WEB_PATHS.signedOut) {
    const reason = new URLSearchParams(search).get(WEB_QUERY.reason)
    return { kind: "signed-out", reason: isSignedOutReason(reason) ? reason : "signed_out" }
  }
  const board = boardOf(pathname)
  if (board !== undefined) return cockpitAt({ view: "board", board }, { kind: "board", board })
  const product: PageTitle = { kind: "product" }
  if (pathname === PAGES.cockpit) return cockpitStart(search, product)
  if (pathname === PAGES.fleet) return { ...cockpitAt(LANDING_ARGS, product), place: FLEET_PLACE }
  return cockpitAt(LANDING_ARGS, product)
}

/** A parameter's text: a place holds ids, names and the cockpit's flags, nothing else. */
function paramOf(value: unknown): string | undefined {
  if (typeof value === "string") return value
  return typeof value === "boolean" || typeof value === "number" ? `${value}` : undefined
}

/**
 * The address of a place of the cockpit, which `routeOf` reads back to it: `/app` the landing,
 * `/app/fleet` the cross-engine overview, `/app/boards/<id>` a board, else `/app/cockpit` with one
 * parameter per argument (`view`, `engine`, the route's ids).
 */
export function urlOf(place: Readonly<Record<string, unknown>>): string {
  const { view, board, ...rest } = place
  const alone = Object.keys(rest).length === 0
  if (alone && view === LANDING_ARGS.view) return PAGES.app
  if (alone && view === FLEET_PLACE.view) return PAGES.fleet
  if (alone && view === "board" && typeof board === "string") {
    return `${BOARD_PREFIX}${encodeURIComponent(board)}`
  }
  const query = new URLSearchParams(
    Object.entries(place).flatMap(([key, value]) => {
      const text = paramOf(value)
      return text === undefined ? [] : [[key, text]]
    }),
  ).toString()
  return query === "" ? PAGES.cockpit : `${PAGES.cockpit}?${query}`
}

/** The sign-in that comes back to `returnTo` (a page and its query), else to `/app`. */
export function signInUrl(returnTo?: string): string {
  if (returnTo === undefined || returnTo === PAGES.app) return WEB_PATHS.login
  return `${WEB_PATHS.login}?${WEB_QUERY.returnTo}=${encodeURIComponent(returnTo)}`
}
