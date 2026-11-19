/**
 * The web app and `/mcp` never take each other's credential. `/mcp` answers a request that carries
 * the session cookie as the gate answers one without a bearer token: 401 with the gate's Bearer
 * challenge, which names the resource's metadata. The cookie is no credential there, and a page's
 * call reaches `/mcp` only as the session's bearer token, which the gate verifies like any other.
 * Every route under `/app` answers 400 to a request that carries an Authorization header: a page
 * never sends one, so a bearer client has no business there.
 */
import { WEB_PATHS, type WebRefusal } from "../protocol/web.js"
import { json } from "./context.js"
import { parseCookies, SESSION_COOKIE } from "./cookies.js"
import { isUnder } from "./return-path.js"

const BEARER_AT_APP: WebRefusal = {
  message: "Bad request: the web app takes its session cookie, never an Authorization header.",
}

const COOKIE_AT_MCP = "This endpoint takes a bearer token, never the web app's session cookie."

/** The MCP endpoint as the separation sees it: its path, and the gate's challenge. */
export interface McpEndpoint {
  readonly path: string
  challenge(description: string): Response
}

/** Whether a request carries the session cookie, any of its chunks (`<name>`, `<name>.1`, …). */
function carriesSession(headers: Headers): boolean {
  const names = [...parseCookies(headers.get("cookie")).keys()]
  return names.some((name) => name === SESSION_COOKIE || name.startsWith(`${SESSION_COOKIE}.`))
}

/** The answer to a request that brings the other side's credential, else `undefined`. */
export function separationRefusal(
  path: string,
  headers: Headers,
  mcp: McpEndpoint,
): Response | undefined {
  if (isUnder(path, WEB_PATHS.app) && headers.has("authorization")) return json(400, BEARER_AT_APP)
  if (path === mcp.path && carriesSession(headers)) return mcp.challenge(COOKIE_AT_MCP)
  return undefined
}
