/**
 * POST /app/api/call: a page's call of a server tool, forwarded in-process to `/mcp` with the
 * session's bearer token. Only the app's own page sends one (the session, then csrf.ts), as JSON
 * of at most 64 KiB, and only for a tool the boot recorded as one a view calls
 * (`openai/widgetAccessible`, which `showToolBinding`, `appOnly` and `forViews` stamp) that only
 * reads (`readOnlyHint`): anything else is refused before any token is read or anything runs.
 *
 * The access token is renewed first where it is due (refresh.ts). The call then goes to
 * `<MCP_URL>/mcp` through the app's own `fetch` as one self-contained JSON-RPC `tools/call` with
 * exactly the headers an MCP client sends (`Host` of `MCP_URL`, `Accept`, the protocol version,
 * `Content-Type`, `Authorization`) and no cookie or `Origin`, so the edge guard, the OAuth gate,
 * the caller's identity, the per-caller caches, passthrough, toolsets, routing and read-only
 * engines treat it as any client's call. After the gate's 401 the token is renewed once where a
 * new one may help. The page gets the tool's result (`{ result }`), never a token: renewed tokens
 * go back sealed into the session's cookie, with the expiry the sign-in gave it, unless the session
 * was signed out at this replica while the call ran (401, and no cookie set: the browser's cookies
 * are the sign-out's, or a new sign-in's). A renewal is due by the token's expiry or by the
 * session's check (refresh.ts), and one rule holds for both. Where the provider refuses the refresh
 * token for the first time at this replica, a token that has not expired still goes out, since a
 * call beside it on another replica may have spent that refresh token (a provider that rotates
 * them); a second refusal of the same tokens, or a refusal once the token expired, ends the session
 * with a 401 that clears no cookie, since that call may just have renewed them. Where the provider
 * does not answer, a token that has not expired goes out (with a check, until two of its intervals
 * after the token's receipt), then 503 until the provider answers; an outage ends no session. The
 * forwarded request carries the page's signal, so a page that leaves or aborts its call cancels the
 * tool's (`ctx.mcpReq.signal`); a renewal under way runs on, since other calls may share it. A call
 * whose page left before `/mcp` answered it a result gets 499 (nginx's "client closed request"),
 * never the 502 of a failing `/mcp`, so a page that leaves counts as no server error in the request
 * log or the metrics.
 */
import { LATEST_PROTOCOL_VERSION, type ToolAnnotations } from "@modelcontextprotocol/server"
import { isExpired } from "@miragon/pulse-http/oauth"
import { WEB_CODES, type WebCallAnswer, type WebRefusal } from "../protocol/web.js"
import type { ToolResult } from "../protocol/tool-result.js"
import { markForwarded } from "../request-log.js"
import { json, SIGNED_OUT, type WebContext } from "./context.js"
import { parseCookies, SESSION_COOKIE, sessionCookies } from "./cookies.js"
import {
  checkMsOf,
  holdsWhileSilent,
  renewableAfterRefusal,
  renewalSource,
  tokenStep,
  type Renewal,
  type RenewalSource,
} from "./refresh.js"
import { pageSession, sessionEnded, type OpenedSession, type SessionTokens } from "./session.js"

/** The largest body of a page's call. */
export const WEB_CALL_MAX_BYTES = 64 * 1024

/** A call whose page left before its answer: nginx's "client closed request", no server error. */
const CLIENT_CLOSED_REQUEST = 499

/** The one id of the forwarded request: it is the only message of its exchange. */
const CALL_ID = 1

const WIDGET_ACCESSIBLE = "openai/widgetAccessible"

/** What the boot recorded of a tool: its annotations and its `_meta`. */
export interface RecordedToolConfig {
  readonly annotations?: ToolAnnotations
  readonly _meta?: Record<string, unknown>
}

/** `/mcp` as the forward reaches it: in-process, and what the boot recorded of each tool. */
export interface McpTarget {
  /** `<MCP_URL>/mcp`, so the edge guard sees the host the server is reached by. */
  readonly url: string
  fetch(request: Request): Promise<Response>
  toolConfig(name: string): RecordedToolConfig | undefined
}

const NOT_JSON: WebRefusal = { message: "Unsupported media type: a call is sent as JSON." }
const TOO_LARGE: WebRefusal = {
  message: `Payload too large: a call holds at most ${WEB_CALL_MAX_BYTES / 1024} KiB.`,
}
const NOT_A_CALL: WebRefusal = {
  message:
    "Bad request: a call is a JSON object of the tool's name and its arguments, and nothing else.",
}
const NOT_FOR_PAGES: WebRefusal = {
  code: WEB_CODES.notForPages,
  message: "Refused: a page calls only the tools a view calls.",
}
const READ_ONLY: WebRefusal = {
  code: WEB_CODES.readOnly,
  message: "Refused: the web app only reads, and this tool writes.",
}
const PAGE_LEFT: WebRefusal = {
  message: "Client closed request: the page left before the tool answered.",
}
const PROVIDER_SILENT: WebRefusal = {
  message:
    "The identity provider does not answer, so the session's token was not renewed. Try again shortly.",
}

/** A page's call as the route takes it. */
interface Call {
  readonly name: string
  readonly arguments: Record<string, unknown>
}

/** What `/mcp` answered past its gate: the tool's result, or a failure. */
type ToolAnswer =
  | { readonly kind: "result"; readonly result: ToolResult }
  | { readonly kind: "failed"; readonly message: string }

/** What `/mcp` answered: past the gate, or the gate's refusal of the token. */
type McpAnswer = ToolAnswer | { readonly kind: "refused" }

/**
 * What became of a call: `/mcp`'s answer with the tokens it went out with, or why it did not go:
 * the session ended (its cookies cleared where nothing else may have renewed them), or the
 * provider does not answer.
 */
type Outcome =
  | { readonly kind: "answered"; readonly answer: ToolAnswer; readonly tokens: SessionTokens }
  | { readonly kind: "ended"; readonly why: string; readonly clears: boolean }
  | { readonly kind: "unavailable" }

/** Why no token went out: the session ended, or the provider does not answer. */
type Unsent = Exclude<Outcome, { kind: "answered" }>

const UNAVAILABLE: Unsent = { kind: "unavailable" }

const ended = (why: string): Unsent => ({ kind: "ended", why, clears: true })

/** The provider refused the refresh token: a call beside this one may have renewed the cookies. */
const REFRESH_REFUSED: Unsent = {
  kind: "ended",
  why: "the identity provider refused the refresh token",
  clears: false,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Whether a `Content-Type` names JSON, whatever its parameters (a charset). */
const isJson = (contentType: string | null): boolean =>
  contentType?.split(";")[0].trim().toLowerCase() === "application/json"

/** The body as text, or `undefined` once it holds more than `max` bytes; read no further. */
async function cappedText(
  body: ReadableStream<Uint8Array>,
  max: number,
): Promise<string | undefined> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength
    if (size > max) {
      await reader.cancel()
      return undefined
    }
    chunks.push(read.value)
  }
  return Buffer.concat(chunks).toString("utf8")
}

/** The call a body holds: `name` and optional `arguments`, both of their type, nothing else. */
function callIn(text: string): Call | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(value)) return undefined
  const { name, arguments: args = {}, ...rest } = value
  if (typeof name !== "string" || !isRecord(args) || Object.keys(rest).length > 0) return undefined
  return { name, arguments: args }
}

async function callOf(request: Request): Promise<Call | Response> {
  if (!isJson(request.headers.get("content-type"))) return json(415, NOT_JSON)
  if (request.body === null) return json(400, NOT_A_CALL)
  const text = await cappedText(request.body as ReadableStream<Uint8Array>, WEB_CALL_MAX_BYTES)
  if (text === undefined) return json(413, TOO_LARGE)
  return callIn(text) ?? json(400, NOT_A_CALL)
}

/** Why a page may not call a tool: it writes, or no view calls it (or this boot has none of it). */
function toolRefusal(config: RecordedToolConfig | undefined): WebRefusal | undefined {
  if (config !== undefined && config.annotations?.readOnlyHint !== true) return READ_ONLY
  return config?._meta?.[WIDGET_ACCESSIBLE] === true ? undefined : NOT_FOR_PAGES
}

/** The JSON-RPC response of an answer in JSON or as an event stream, if it holds one. */
function responseIn(text: string, contentType: string | null): Record<string, unknown> | undefined {
  const stream = contentType?.toLowerCase().startsWith("text/event-stream") === true
  const payloads = stream
    ? text
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length))
    : [text]
  for (const payload of payloads) {
    try {
      const message: unknown = JSON.parse(payload)
      if (isRecord(message) && ("result" in message || "error" in message)) return message
    } catch {
      // Not a JSON-RPC message: the next line may hold it.
    }
  }
  return undefined
}

async function answerOf(response: Response): Promise<McpAnswer> {
  const text = await response.text()
  if (response.status === 401) return { kind: "refused" }
  const message = responseIn(text, response.headers.get("content-type"))
  if (isRecord(message?.result)) return { kind: "result", result: message.result }
  const error = isRecord(message?.error) ? message.error.message : undefined
  const failure =
    typeof error === "string" ? error : `The MCP endpoint answered HTTP ${response.status}.`
  return { kind: "failed", message: failure }
}

/**
 * The call as one self-contained `tools/call` to `/mcp`, with exactly an MCP client's headers and
 * the page's signal.
 */
async function sent(route: CallRoute, accessToken: string, call: Call): Promise<McpAnswer> {
  const { target, signal } = route
  const request = new Request(target.url, {
    method: "POST",
    signal,
    headers: {
      host: new URL(target.url).host,
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: CALL_ID, method: "tools/call", params: call }),
  })
  return answerOf(await target.fetch(markForwarded(request)))
}

/**
 * The tokens after a refresh, or why there are none to send. Without new ones, the `kept` token
 * goes out while it has not expired after the provider's first refusal of it at this replica (a
 * race with another replica's renewal), and while the provider is silent as `holdsWhileSilent` says.
 */
function afterRenewal(
  renewal: Renewal,
  kept: SessionTokens,
  now: number,
  checkMs: number | undefined,
): SessionTokens | Unsent {
  if (renewal.kind === "renewed") return renewal.tokens
  if (renewal.kind === "refused") {
    return renewal.final || isExpired(kept, now) ? REFRESH_REFUSED : kept
  }
  return holdsWhileSilent(kept, now, checkMs) ? kept : UNAVAILABLE
}

/**
 * The tokens to send: the session's, renewed first where they are due by their expiry or the
 * session's check, or why none go out.
 */
export async function tokensToSend(
  ctx: WebContext,
  renew: RenewalSource,
  tokens: SessionTokens,
): Promise<SessionTokens | Unsent> {
  const checkMs = checkMsOf(ctx.settings)
  const step = tokenStep(tokens, ctx.platform.now(), checkMs)
  if (step.kind === "send") return tokens
  if (step.kind === "end") return ended(step.why)
  return afterRenewal(await renew(step.tokens), tokens, ctx.platform.now(), checkMs)
}

/** After the gate refused `tokens`: one renewal where a new token may help, and the call again. */
async function afterRefusal(
  ctx: WebContext,
  route: CallRoute,
  tokens: SessionTokens,
  call: Call,
): Promise<Outcome> {
  const renewable = renewableAfterRefusal(tokens, ctx.platform.now())
  if (renewable === undefined) return ended("the gate refused the session's token")
  const renewal = await route.renew(renewable)
  if (renewal.kind === "unavailable") return UNAVAILABLE
  if (renewal.kind === "refused") return REFRESH_REFUSED
  const answer = await sent(route, renewal.tokens.accessToken, call)
  if (answer.kind === "refused") return ended("the gate refused the renewed token")
  return { kind: "answered", answer, tokens: renewal.tokens }
}

/** Where a page's call goes, what renews its tokens, and the page's signal. */
interface CallRoute {
  readonly target: McpTarget
  readonly renew: RenewalSource
  readonly signal: AbortSignal
}

async function called(
  ctx: WebContext,
  route: CallRoute,
  session: OpenedSession,
  call: Call,
): Promise<Outcome> {
  const tokens = await tokensToSend(ctx, route.renew, session.session.tokens)
  if ("kind" in tokens) return tokens
  const answer = await sent(route, tokens.accessToken, call)
  if (answer.kind === "refused") return afterRefusal(ctx, route, tokens, call)
  return { kind: "answered", answer, tokens }
}

/** The session's cookies with `tokens` sealed in, its expiry kept; `undefined` when they do not fit. */
async function resealed(
  ctx: WebContext,
  opened: OpenedSession,
  tokens: SessionTokens,
  request: Request,
): Promise<readonly string[] | undefined> {
  const sealed = await ctx.sealer.reseal(SESSION_COOKIE, opened, { ...opened.session, tokens })
  const jar = parseCookies(request.headers.get("cookie"))
  const cookies = sessionCookies(sealed, opened.expiresAt, jar, ctx.platform.now())
  return cookies.fits ? cookies.setCookies : undefined
}

/**
 * The cookies an answer of the session sets with the `tokens` its request went out with: none for
 * the session's own, renewed ones sealed in with its expiry kept; the session's end where those no
 * longer fit its cookies.
 */
export async function cookiesWith(
  ctx: WebContext,
  opened: OpenedSession,
  tokens: SessionTokens,
  request: Request,
): Promise<readonly string[] | Response> {
  if (tokens === opened.session.tokens) return []
  const setCookies = await resealed(ctx, opened, tokens, request)
  return setCookies ?? sessionEnded(ctx, "the renewed session does not fit its cookies")
}

/**
 * The 401 of a request whose session was signed out at this replica while it ran (the `action` in
 * the log line): no result and no cookie, so the browser's cookies stay the sign-out's, or a new
 * sign-in's; `undefined` for a session that holds.
 */
export function signedOutMeanwhile(
  ctx: WebContext,
  opened: OpenedSession,
  action: string,
): Response | undefined {
  if (!ctx.ended.has(opened.session.id, ctx.platform.now())) return undefined
  ctx.log(`${action} answered after its session was signed out: no result, no cookie.`)
  return json(401, SIGNED_OUT)
}

/** The answer where no token went out: the session's end, or 503 while the provider is silent. */
export function unsentAnswer(ctx: WebContext, unsent: Unsent): Response {
  if (unsent.kind === "ended") return sessionEnded(ctx, unsent.why, unsent.clears)
  return json(503, PROVIDER_SILENT)
}

/**
 * The page's answer: the result, or why there is none; renewed tokens sealed into its cookie. A
 * session signed out at this replica while the call ran gets no result and sets no cookie.
 */
async function answered(
  ctx: WebContext,
  opened: OpenedSession,
  request: Request,
  outcome: Outcome,
): Promise<Response> {
  const signedOut = signedOutMeanwhile(ctx, opened, "Web call")
  if (signedOut !== undefined) return signedOut
  if (outcome.kind === "answered") return answerWith(ctx, opened, request, outcome)
  return unsentAnswer(ctx, outcome)
}

/**
 * `/mcp`'s answer to the page (499 where the page left before a result), the session's cookies
 * renewed where its tokens were.
 */
async function answerWith(
  ctx: WebContext,
  opened: OpenedSession,
  request: Request,
  { answer, tokens }: Extract<Outcome, { kind: "answered" }>,
): Promise<Response> {
  const setCookies = await cookiesWith(ctx, opened, tokens, request)
  if (setCookies instanceof Response) return setCookies
  if (answer.kind === "result") {
    const body: WebCallAnswer = { result: answer.result }
    return json(200, body, setCookies)
  }
  if (request.signal.aborted) return json(CLIENT_CLOSED_REQUEST, PAGE_LEFT, setCookies)
  return json(502, { message: answer.message }, setCookies)
}

/**
 * The call route over `target`, its tokens renewed through `renew`: the replica's renewals, which
 * the session route shares (install.ts), so a page's read of its session and its calls renew a
 * pair of tokens once.
 */
export function callRoute(
  ctx: WebContext,
  target: McpTarget,
  renew: RenewalSource = renewalSource(ctx),
): (request: Request) => Promise<Response> {
  return async (request) => {
    const opened = await pageSession(ctx, request, "Web call")
    if (opened instanceof Response) return opened
    const call = await callOf(request)
    if (call instanceof Response) return call
    const refusal = toolRefusal(target.toolConfig(call.name))
    if (refusal !== undefined) return json(403, refusal)
    const route: CallRoute = { target, renew, signal: request.signal }
    return answered(ctx, opened, request, await called(ctx, route, opened, call))
  }
}
