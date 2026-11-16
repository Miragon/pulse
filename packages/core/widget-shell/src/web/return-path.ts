/**
 * Where a sign-in returns to: a path of the web app and its query, never another site or another
 * route of this server, so the login route is no open redirect. The path must lie under `/app` in
 * the normal form the listener lets through (no dot or empty segment in any spelling, no
 * backslash, no fragment, no trailing slash), the query is read and written again by
 * `URLSearchParams`, so it carries no character a `Location` header would read otherwise, and the
 * whole target holds at most 1,024 characters. Anything else returns to `/app`.
 */
import { isNormalTarget, pathOfTarget } from "../http-edge.js"
import { WEB_PATHS } from "../protocol/web.js"

/** The longest target a sign-in returns to: a deep link, never a payload. */
export const MAX_RETURN_TARGET = 1024

const isUnderApp = (path: string): boolean =>
  path === WEB_PATHS.app || path.startsWith(`${WEB_PATHS.app}/`)

/** The target a sign-in returns to for the one a request names (absent: the app's start). */
export function returnTarget(requested: string | null | undefined): string {
  if (!requested || requested.length > MAX_RETURN_TARGET) return WEB_PATHS.app
  const path = pathOfTarget(requested)
  if (!isUnderApp(path) || !isNormalTarget(path)) return WEB_PATHS.app
  const query = new URLSearchParams(requested.slice(path.length + 1)).toString()
  const target = query === "" ? path : `${path}?${query}`
  return target.length > MAX_RETURN_TARGET ? WEB_PATHS.app : target
}
