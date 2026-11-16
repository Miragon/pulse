import {
  isSignedOutReason,
  WEB_PATHS,
  WEB_QUERY,
  type SignedOutReason,
} from "@miragon/pulse-widget-shell/widgets"
import { PAGES } from "./pages.js"

/** The engine module's view, the cockpit: every page of the app opens it at a start of its own. */
export const COCKPIT_VIEW = "engine_open_cockpit"

/** The cockpit's arguments that take no text: a query's `true` or `false` is their value. */
const COCKPIT_FLAGS: ReadonlySet<string> = new Set(["failedOnly"])

/** Where a page's location leads: a view with its view tool's arguments, or the signed-out page. */
export type PageRoute =
  | {
      readonly kind: "view"
      readonly view: string
      readonly args: Readonly<Record<string, unknown>>
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

/**
 * The route a location opens. The signed-out page reads its reason, the one of a sign-out where
 * the query names none (the identity provider's way back after a sign-out names none). The
 * navigation inside the cockpit stays in the page: the URL names where it starts.
 */
export function routeOf({ pathname, search }: PageLocation): PageRoute {
  if (pathname === WEB_PATHS.signedOut) {
    const reason = new URLSearchParams(search).get(WEB_QUERY.reason)
    return { kind: "signed-out", reason: isSignedOutReason(reason) ? reason : "signed_out" }
  }
  const args = pathname === PAGES.cockpit ? cockpitArgs(search) : {}
  return { kind: "view", view: COCKPIT_VIEW, args }
}

/** The sign-in that comes back to `returnTo` (a page and its query), else to `/app`. */
export function signInUrl(returnTo?: string): string {
  if (returnTo === undefined || returnTo === PAGES.app) return WEB_PATHS.login
  return `${WEB_PATHS.login}?${WEB_QUERY.returnTo}=${encodeURIComponent(returnTo)}`
}
