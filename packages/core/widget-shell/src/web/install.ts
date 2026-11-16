/**
 * The web app's sign-in on the boot's HTTP app: login, callback, logout and the session route
 * under `/app`, behind the HTTP edge guard, through the server's own OAuth provider as a
 * confidential client (`MCP_WEB_*`). The boot installs it only beside a provider, so the identity
 * of a web session comes from where every caller's does: a token the gate in front of `/mcp`
 * verifies. In front of the routes stands the separation of the two credentials (separation.ts).
 */
import type { Platform } from "@miragon/pulse-http"
import type { McpHttpApp } from "../mcp-server.js"
import { gateChallenge, gateTokenCheck } from "../oauth-gate.js"
import type { OAuthProvider, OAuthWebClient } from "../oauth-providers.js"
import { WEB_PATHS } from "../protocol/web.js"
import { callbackRoute } from "./callback.js"
import type { WebContext } from "./context.js"
import { metadataSource } from "./discovery.js"
import { loginRoute } from "./login.js"
import { logoutRoute } from "./logout.js"
import { isNoPage } from "./return-path.js"
import { createSealer } from "./seal.js"
import { separationRefusal, type McpEndpoint } from "./separation.js"
import { sessionRoute } from "./session-route.js"
import type { WebSettings } from "./settings.js"

/** What a provider that names no web client of its own signs in with. */
const OPENID_ONLY: OAuthWebClient = { scopes: ["openid"] }

/**
 * What the sign-in asks the provider for: its web client (`openid` alone without one), and the
 * scopes the gate requires of every token besides, or a session's token would never pass it.
 */
function webClientOf(provider: OAuthProvider): OAuthWebClient {
  const web = provider.web ?? OPENID_ONLY
  return { ...web, scopes: [...new Set([...web.scopes, ...(provider.requiredScopes ?? [])])] }
}

export interface WebSignInOptions {
  readonly settings: WebSettings
  readonly provider: OAuthProvider
  /** The gate's resource, as the app resolved it: the provider's own, else `MCP_URL`'s `/mcp`. */
  readonly resource: URL
  /** Prefixes the lines the sign-in logs. */
  readonly label: string
}

const PLATFORM: Platform = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
}

export function installWebSignIn(app: McpHttpApp, options: WebSignInOptions): void {
  const { settings, provider, resource, label } = options
  const { issuer } = provider.oauthMetadata
  const log = (line: string): void => console.warn(`[${label}] ${line}`)
  const ctx: WebContext = {
    settings,
    sealer: createSealer(settings.sessionKeys),
    client: webClientOf(provider),
    resource: resource.href,
    issuer,
    metadata: metadataSource(issuer, PLATFORM, log),
    verify: gateTokenCheck(provider, resource),
    platform: PLATFORM,
    log,
  }
  const mcp: McpEndpoint = { path: app.basePath, challenge: gateChallenge(provider, resource) }
  // Every answer of a route that is no page (the sign-in's, the API's) is no-store, a 404 too.
  app.use("*", async (c, next) => {
    const { path } = c.req
    const refused = separationRefusal(path, c.req.raw.headers, mcp)
    if (refused !== undefined) return refused
    await next()
    if (isNoPage(path)) c.header("cache-control", "no-store")
  })
  const login = loginRoute(ctx)
  const callback = callbackRoute(ctx)
  const logout = logoutRoute(ctx)
  const session = sessionRoute(ctx)
  app.get(WEB_PATHS.login, (c) => login(c.req.raw))
  app.get(WEB_PATHS.callback, (c) => callback(c.req.raw))
  app.post(WEB_PATHS.logout, (c) => logout(c.req.raw))
  app.get(WEB_PATHS.session, (c) => session(c.req.raw))
}
