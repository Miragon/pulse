/**
 * The web app on the boot's HTTP app: its sign-in (login, callback, logout, the session route), the
 * page's calls and the web build's pages and assets (static.ts) under `/app`, behind the HTTP edge
 * guard, through the server's own OAuth provider as a confidential client (`MCP_WEB_*`). The boot
 * installs it only beside a provider, so the identity of a web session comes from where every
 * caller's does: a token the gate in front of `/mcp` verifies, which a page's call reaches `/mcp`
 * with in-process (forward.ts). In front of the routes stands the separation of the two credentials
 * (separation.ts); every answer under `/app` carries the security headers (security-headers.ts) and
 * is `no-store` unless it names a cache policy of its own (an asset).
 */
import type { Platform } from "@miragon/pulse-http"
import type { McpHttpApp } from "../mcp-server.js"
import { gateChallenge, gateTokenCheck } from "../oauth-gate.js"
import type { OAuthProvider, OAuthWebClient } from "../oauth-providers.js"
import { WEB_PATHS } from "../protocol/web.js"
import { callbackRoute } from "./callback.js"
import type { WebContext } from "./context.js"
import { metadataSource } from "./discovery.js"
import { endedSessions } from "./ended.js"
import { callRoute, type McpTarget } from "./forward.js"
import { loginRoute } from "./login.js"
import { logoutRoute } from "./logout.js"
import { renewalSource } from "./refresh.js"
import { isUnder } from "./return-path.js"
import { createSealer } from "./seal.js"
import { webSecurityHeaders } from "./security-headers.js"
import { separationRefusal, type McpEndpoint } from "./separation.js"
import { sessionRoute } from "./session-route.js"
import type { WebSettings } from "./settings.js"
import { installWebBuild, type WebBuild } from "./static.js"

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
  /** The web build the boot read from `settings.dir`. */
  readonly build: WebBuild
}

const PLATFORM: Platform = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
}

export function installWebSignIn(app: McpHttpApp, options: WebSignInOptions): void {
  const { settings, provider, resource, label, build } = options
  const { issuer } = provider.oauthMetadata
  const log = (line: string): void => console.warn(`[${label}] ${line}`)
  const ctx: WebContext = {
    settings,
    sealer: createSealer(settings.sessionKeys),
    ended: endedSessions(),
    client: webClientOf(provider),
    resource: resource.href,
    issuer,
    metadata: metadataSource(issuer, PLATFORM, log),
    verify: gateTokenCheck(provider, resource),
    platform: PLATFORM,
    log,
  }
  const mcp: McpEndpoint = { path: app.basePath, challenge: gateChallenge(provider, resource) }
  const secured = Object.entries(webSecurityHeaders(settings.origin))
  app.use("*", async (c, next) => {
    const { path } = c.req
    const refused = separationRefusal(path, c.req.raw.headers, mcp)
    if (refused === undefined) await next()
    else c.res = refused
    if (!isUnder(path, WEB_PATHS.app)) return
    for (const [name, value] of secured) c.header(name, value)
    // A 404 too: only an asset, whose name carries its hash, may be kept.
    if (!c.res.headers.has("cache-control")) c.header("cache-control", "no-store")
  })
  const login = loginRoute(ctx)
  const callback = callbackRoute(ctx)
  const logout = logoutRoute(ctx)
  // One renewal per pair of tokens on this replica, whether a call or the session's read renews it.
  const renew = renewalSource(ctx)
  const session = sessionRoute(ctx, renew)
  const call = callRoute(ctx, mcpTarget(app, settings), renew)
  app.get(WEB_PATHS.login, (c) => login(c.req.raw))
  app.get(WEB_PATHS.callback, (c) => callback(c.req.raw))
  app.post(WEB_PATHS.logout, (c) => logout(c.req.raw))
  app.get(WEB_PATHS.session, (c) => session(c.req.raw))
  app.post(WEB_PATHS.call, (c) => call(c.req.raw))
  installWebBuild(app, build, ctx)
}

/** `/mcp` of this app as a page's call reaches it: in-process, at `MCP_URL`'s host. */
function mcpTarget(app: McpHttpApp, settings: WebSettings): McpTarget {
  return {
    url: `${settings.origin}${app.basePath}`,
    fetch: (request) => app.fetch(request),
    toolConfig: (name) => app.toolConfig(name),
  }
}
