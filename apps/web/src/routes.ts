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
 * the signed-out page.
 */
export type PageRoute =
  | {
      readonly kind: "view"
      readonly view: string
      readonly args: Readonly<Record<string, unknown>>
      readonly title: PageTitle
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

const cockpitAt = (args: Record<string, unknown>, title: PageTitle): PageRoute => ({
  kind: "view",
  view: COCKPIT_VIEW,
  args,
  title,
})

/**
 * The route a location opens. `/app` is the cockpit's landing: the engines and the server's
 * boards, with one engine too where the server has boards (with one engine and none, the cockpit
 * opens that engine). A board's page opens the cockpit's board view by its id, which the tool
 * refuses where the server shows no such board, and the page says why. The signed-out page reads
 * its reason, the one of a sign-out where the query names none (the identity provider's way back
 * after a sign-out names none). The navigation inside the cockpit stays in the page: the URL names
 * where it starts.
 */
export function routeOf({ pathname, search }: PageLocation): PageRoute {
  if (pathname === WEB_PATHS.signedOut) {
    const reason = new URLSearchParams(search).get(WEB_QUERY.reason)
    return { kind: "signed-out", reason: isSignedOutReason(reason) ? reason : "signed_out" }
  }
  const board = boardOf(pathname)
  if (board !== undefined) return cockpitAt({ view: "board", board }, { kind: "board", board })
  const product: PageTitle = { kind: "product" }
  return cockpitAt(pathname === PAGES.cockpit ? cockpitArgs(search) : { view: "landing" }, product)
}

/** The sign-in that comes back to `returnTo` (a page and its query), else to `/app`. */
export function signInUrl(returnTo?: string): string {
  if (returnTo === undefined || returnTo === PAGES.app) return WEB_PATHS.login
  return `${WEB_PATHS.login}?${WEB_QUERY.returnTo}=${encodeURIComponent(returnTo)}`
}
