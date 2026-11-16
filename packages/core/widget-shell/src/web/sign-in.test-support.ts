/**
 * The web sign-in's tests: a composed server with the Keycloak provider pointed at the fake
 * identity provider and the web app on, a browser's cookie jar over `app.fetch`, a whole sign-in,
 * and the routes' context built by hand for the cases a whole server cannot reach.
 */
import type { Platform } from "@miragon/pulse-http"
import { createComposedServer, type ComposedServerOptions } from "../composed-server.js"
import { moduleOf, plain } from "../composed-server.test-support.js"
import type { McpHttpApp } from "../mcp-server.js"
import { gateTokenCheck } from "../oauth-gate.js"
import { oauthKeycloakProvider } from "../oauth-providers.js"
import { FAKE_OIDC_CLIENT, type FakeOidc } from "../testing/oidc/index.js"
import { FIXTURE_BUILD } from "./build.test-support.js"
import type { WebContext } from "./context.js"
import { metadataSource } from "./discovery.js"
import { createSealer } from "./seal.js"

export const ORIGIN = "http://localhost"
export const RESOURCE = `${ORIGIN}/mcp`
export const KEY = new Uint8Array(32).fill(3)
export const SESSION_KEYS = Buffer.from(KEY).toString("base64url")
export const FLAGS = "Path=/; HttpOnly; Secure; SameSite=Lax"
export const HOUR = 3_600_000

const PLATFORM: Platform = {
  fetch: (input, init) => fetch(input, init),
  now: () => Date.now(),
}

/**
 * The variables of a server whose web app signs in at `fake` as its confidential client and serves
 * the fixture build.
 */
export const webEnv = (fake: FakeOidc, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  MCP_URL: ORIGIN,
  MCP_OAUTH_KEYCLOAK_SERVER_URL: fake.serverUrl,
  MCP_OAUTH_KEYCLOAK_REALM: fake.realm,
  MCP_WEB_CLIENT_ID: FAKE_OIDC_CLIENT.id,
  MCP_WEB_CLIENT_SECRET: FAKE_OIDC_CLIENT.secret,
  MCP_WEB_SESSION_KEYS: SESSION_KEYS,
  MCP_WEB_DIR: FIXTURE_BUILD,
  ...extra,
})

const probe = moduleOf({ name: "probe", register: (server) => plain(server, "probe_tool") })

/** A composed server with the web app on against `fake`, unless `env` says otherwise. */
export async function bootWeb(
  env: NodeJS.ProcessEnv,
  overrides: Partial<ComposedServerOptions> = {},
): Promise<McpHttpApp> {
  const composed = await createComposedServer({
    info: { name: "web-test", version: "0.0.0" },
    modules: [probe],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env,
    ...overrides,
  })
  return composed.app
}

/** The name and value of a `Set-Cookie` value. */
function pairOf(setCookie: string): [string, string] {
  const [pair] = setCookie.split(";")
  const at = pair.indexOf("=")
  return [pair.slice(0, at), pair.slice(at + 1)]
}

/** A browser over `app.fetch`: it keeps the cookies the answers set and sends them back. */
export class Browser {
  readonly cookies = new Map<string, string>()

  constructor(private readonly app: McpHttpApp) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
  }

  async fetch(
    target: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {},
  ) {
    const cookie = this.cookieHeader
    const headers = { host: "localhost", ...(cookie ? { cookie } : {}), ...init.headers }
    const { method, body } = init
    const request = new Request(new URL(target, ORIGIN), { method, headers, body })
    const response = await this.app.fetch(request)
    for (const setCookie of response.headers.getSetCookie()) {
      const [name, value] = pairOf(setCookie)
      if (/Max-Age=0(;|$)/.test(setCookie)) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
    return response
  }

  /** The sign-out as the app's page sends it: a POST of its own origin with the CSRF token. */
  logout(csrf: string, headers: Record<string, string> = {}) {
    const own = { origin: ORIGIN, "sec-fetch-site": "same-origin", "x-pulse-csrf": csrf }
    return this.fetch("/app/auth/logout", { method: "POST", headers: { ...own, ...headers } })
  }
}

/** The login route's answer and the URL the provider sends the browser back to. */
export async function startSignIn(browser: Browser, fake: FakeOidc, returnTo?: string) {
  const query = returnTo === undefined ? "" : `?return=${encodeURIComponent(returnTo)}`
  const login = await browser.fetch(`/app/auth/login${query}`)
  const authorization = String(login.headers.get("location"))
  return { login, authorization }
}

/** A whole sign-in: the login route, the provider's page as `username`, the callback's answer. */
export async function signIn(
  browser: Browser,
  fake: FakeOidc,
  { returnTo, username }: { returnTo?: string; username?: string } = {},
): Promise<Response> {
  const { authorization } = await startSignIn(browser, fake, returnTo)
  return browser.fetch(await fake.signIn(authorization, username))
}

/** The session route's answer as JSON. */
export async function sessionOf(browser: Browser) {
  const response = await browser.fetch("/app/api/session")
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

/** The routes' context against `fake`, as the boot would build it, each part replaceable. */
export function webContext(fake: FakeOidc, overrides: Partial<WebContext> = {}) {
  const provider = oauthKeycloakProvider({ serverUrl: fake.serverUrl, realm: fake.realm })
  const logged: string[] = []
  const log = (line: string) => logged.push(line)
  const ctx: WebContext = {
    settings: {
      clientId: FAKE_OIDC_CLIENT.id,
      clientSecret: String(FAKE_OIDC_CLIENT.secret),
      sessionKeys: [KEY],
      sessionHours: 8,
      dir: FIXTURE_BUILD,
      origin: ORIGIN,
    },
    sealer: createSealer([KEY]),
    client: { scopes: ["openid", "profile"] },
    resource: RESOURCE,
    issuer: fake.issuer,
    metadata: metadataSource(fake.issuer, PLATFORM, log),
    verify: gateTokenCheck(provider, new URL(RESOURCE)),
    platform: PLATFORM,
    log,
    ...overrides,
  }
  return { ctx, logged }
}

/** A request to a route of the context, as the browser sends it. */
export const requestTo = (
  target: string,
  headers: Record<string, string> = {},
  method = "GET",
): Request => new Request(new URL(target, ORIGIN), { method, headers })
