/**
 * The page's calls under test without a whole server: the routes' context on a clock of the test's
 * own and a token endpoint that answers as scripted, a session sealed by hand, a page's request to
 * the call route, and `/mcp` as a target that records what reaches it and answers as told.
 */
import type { Platform } from "@miragon/pulse-http"
import type { ServerMetadata } from "@miragon/pulse-http/oauth"
import { stubOAuth } from "../composed-server.test-support.js"
import { gateTokenCheck } from "../oauth-gate.js"
import { FIXTURE_BUILD } from "./build.test-support.js"
import type { WebContext } from "./context.js"
import { SESSION_COOKIE } from "./cookies.js"
import { endedSessions } from "./ended.js"
import { callRoute, type McpTarget, type RecordedToolConfig } from "./forward.js"
import { createSealer } from "./seal.js"
import type { SessionTokens, WebSession } from "./session.js"
import type { WebSettings } from "./settings.js"
import { FLAGS, KEY, ORIGIN, RESOURCE } from "./sign-in.test-support.js"

export const T0 = Date.UTC(2026, 10, 16, 12)
export const SECOND = 1000
export const CSRF = "csrf-secret-of-the-session"

const METADATA: ServerMetadata = {
  issuer: "https://idp.example.test/realms/pulse",
  authorizationEndpoint: "https://idp.example.test/realms/pulse/auth",
  tokenEndpoint: "https://idp.example.test/realms/pulse/token",
  issParameterRequired: false,
  clientAuth: "basic",
}

/** A token endpoint's answer: its status and JSON, no connection, or an answer that never comes. */
export type TokenAnswer =
  { readonly status: number; readonly body: unknown } | "unreachable" | "hangs"

/** A token answer as Keycloak gives it for a refresh: `access`, valid for `seconds`, and more. */
export const tokens = (access: string, extra: Record<string, unknown> = {}): TokenAnswer => ({
  status: 200,
  body: { access_token: access, token_type: "Bearer", expires_in: 300, ...extra },
})

/** A clock the test moves, and a token endpoint that answers from its script, in order. */
export function scriptedProvider(...script: TokenAnswer[]) {
  const clock = { now: T0 }
  const forms: URLSearchParams[] = []
  const authorizations: (string | null)[] = []
  const platform: Platform = {
    now: () => clock.now,
    fetch: (_input, init) => {
      forms.push(new URLSearchParams(init?.body as string))
      authorizations.push(new Headers(init?.headers).get("authorization"))
      const answer = script.shift()
      if (answer === "hangs") return new Promise<Response>(() => {})
      if (answer === undefined || answer === "unreachable") {
        return Promise.reject(new TypeError("fetch failed"))
      }
      return Promise.resolve(Response.json(answer.body, { status: answer.status }))
    },
  }
  return { clock, forms, authorizations, platform }
}

/** The web app's settings of the tests' context, without a check at the provider. */
export const SETTINGS: WebSettings = {
  clientId: "pulse-web",
  clientSecret: "pulse-web-secret",
  sessionKeys: [KEY],
  sessionHours: 8,
  sessionCheckMinutes: undefined,
  dir: FIXTURE_BUILD,
  origin: ORIGIN,
}

/** The tests' settings with the session checked at the provider every `minutes`. */
export const checkedEvery = (minutes: number): Partial<WebContext> => ({
  settings: { ...SETTINGS, sessionCheckMinutes: minutes },
})

/** The routes' context over `platform`, as the boot builds it, with the provider's metadata. */
export function callContext(
  platform: Platform,
  overrides: Partial<WebContext> = {},
): { ctx: WebContext; logged: string[] } {
  const logged: string[] = []
  const ctx: WebContext = {
    settings: SETTINGS,
    sealer: createSealer([KEY]),
    ended: endedSessions(),
    client: { scopes: ["openid"] },
    resource: RESOURCE,
    issuer: METADATA.issuer,
    callerClaims: ["sub"],
    metadata: () => Promise.resolve(METADATA),
    // The call route verifies no token itself: `/mcp`'s gate does.
    verify: gateTokenCheck(stubOAuth(), new URL(RESOURCE)),
    platform,
    log: (line) => logged.push(line),
    ...overrides,
  }
  return { ctx, logged }
}

/** Tokens received at `receivedAt`, valid for five minutes, with a refresh token. */
export const sessionTokens = (
  receivedAt: number,
  extra: Partial<SessionTokens> = {},
): SessionTokens => ({
  accessToken: "access-1",
  receivedAt,
  expiresAt: receivedAt + 300 * SECOND,
  refreshToken: "refresh-1",
  ...extra,
})

/** The `Cookie` header of a session holding `tokens`, sealed by `ctx` until `expiresAt`. */
export async function sessionCookie(
  ctx: WebContext,
  tokens: SessionTokens,
  expiresAt = T0 + 8 * 3_600_000,
): Promise<string> {
  const session: WebSession = { id: "session-1", csrf: CSRF, name: "Alice Adams", tokens }
  return `${SESSION_COOKIE}=${await ctx.sealer.seal(SESSION_COOKIE, session, expiresAt)}`
}

/** A page's call as the browser sends it: its own origin, the CSRF token, JSON, its signal. */
export function pageCall(
  cookie: string,
  body: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Request {
  return new Request(`${ORIGIN}/app/api/call`, {
    method: "POST",
    signal,
    headers: {
      cookie,
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
      "x-pulse-csrf": CSRF,
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  })
}

/** What `/mcp` answers a forwarded call: a status, its content type if any, and a body as text. */
export interface McpReply {
  readonly status?: number
  readonly contentType?: string
  readonly body: string
}

/** A JSON-RPC result of the forwarded call, as `/mcp` answers it in JSON. */
export const result = (value: unknown): McpReply => ({
  contentType: "application/json",
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: value }),
})

export const GATE_REFUSAL: McpReply = {
  status: 401,
  contentType: "application/json",
  body: '{"error":"invalid_token"}',
}

/** The tools a test's boot recorded, by name. */
const TOOLS: Readonly<Record<string, RecordedToolConfig>> = {
  probe_rows_data: {
    annotations: { readOnlyHint: true },
    _meta: { ui: { visibility: ["app"] }, "openai/widgetAccessible": true },
  },
  probe_model_read: { annotations: { readOnlyHint: true } },
  // MCP reads a tool without annotations as one that writes.
  probe_bare: { _meta: { "openai/widgetAccessible": true } },
  probe_write: {
    annotations: { destructiveHint: false },
    _meta: { "openai/widgetAccessible": true },
  },
}

/** `/mcp` as a target: it records each request that reaches it and answers from `replies`. */
export function mcpTarget(...replies: McpReply[]) {
  const requests: Request[] = []
  const bodies: unknown[] = []
  const target: McpTarget = {
    url: `${ORIGIN}/mcp`,
    fetch: async (request) => {
      requests.push(request)
      bodies.push(await request.clone().json())
      const reply = replies.shift() ?? result({ content: [] })
      const headers =
        reply.contentType === undefined ? undefined : { "content-type": reply.contentType }
      // As bytes, so an answer without a content type carries none.
      const bytes = new TextEncoder().encode(reply.body)
      return new Response(bytes, { status: reply.status ?? 200, headers })
    },
    toolConfig: (name) => TOOLS[name],
  }
  return { target, requests, bodies }
}

/** The Authorization each request that reached `/mcp` carried. */
export const bearersOf = (requests: readonly Request[]): (string | null)[] =>
  requests.map((request) => request.headers.get("authorization"))

export const ROWS = { name: "probe_rows_data", arguments: { engine: "prod" } }
export const RESULT = { content: [{ type: "text", text: '{"rows":[]}' }] }
export const SIGNED_OUT = { code: "signed_out", message: "No session: sign in again." }
export const CLEARED = [SESSION_COOKIE, `${SESSION_COOKIE}.1`, `${SESSION_COOKIE}.2`].map(
  (name) => `${name}=; Max-Age=0; ${FLAGS}`,
)
export const DUE = T0 + 270 * SECOND
export const EXPIRED = T0 + 300 * SECOND

interface Setup {
  /** What the provider's token endpoint answers, in order. */
  provider?: TokenAnswer[]
  /** Parts of the routes' context the test replaces (`checkedEvery`). */
  context?: Partial<WebContext>
  /** What `/mcp` answers, in order (default: a result). */
  mcp?: McpReply[]
  /** The session's tokens (default: received at T0, five minutes, a refresh token). */
  session?: Parameters<typeof sessionTokens>[1]
  /** The clock when the call comes. */
  at?: number
}

/** A call route on a scripted provider and target, with a session sealed at T0. */
export async function setup({ provider = [], context, mcp = [], session, at = T0 }: Setup = {}) {
  const idp = scriptedProvider(...provider)
  const { ctx, logged } = callContext(idp.platform, context)
  const cookie = await sessionCookie(ctx, sessionTokens(T0, session))
  const mcpSide = mcpTarget(...mcp)
  idp.clock.now = at
  const route = callRoute(ctx, mcpSide.target)
  const call = (body: unknown = ROWS, headers: Record<string, string> = {}) =>
    route(pageCall(cookie, body, headers))
  return { ...mcpSide, idp, ctx, logged, call }
}

export const jsonOf = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
})
