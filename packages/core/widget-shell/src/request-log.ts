/**
 * One line per HTTP request on stdout:
 *
 *   tools/call engine_status /mcp 200 client=claude-code/2.1 12ms
 *   tools/list /mcp 406 client=unknown 0ms ERROR Not Acceptable: Client must accept …
 *   batch(ping,tools/list) /mcp 200 client=unknown 4ms
 *   GET /health/ready 200 1ms
 *
 * An MCP POST is named by its JSON-RPC request (method, tool, prompt or resource, client), read
 * off a clone. A failed exchange ends in `ERROR <text>`: the JSON-RPC error, a tool's `isError`
 * text, an OAuth refusal's description, else `(HTTP <status>)`; any other request refused in JSON
 * (the edge guard's 403, a `PUT /mcp`'s 405) names its error too, except the 405 a client's
 * `GET /mcp` (the standalone stream) or `DELETE /mcp` (a session's end) gets from a server without
 * either: that is the protocol at work. A streamed answer (SSE) is read off a clone once it
 * ended, so the client gets every frame as it is written and the line follows the stream;
 * `subscriptions/listen` stays open, so its line comes at once, without an outcome.
 *
 * `MCP_LOG_LEVEL`: `info` (default) logs no payload; `debug` adds a tool's or prompt's arguments
 * and a tool's result, each cut at 80 characters; `trace` adds the whole request and response,
 * credential headers redacted. Both put process variables and business keys into the log, so the
 * boot warns (`requestLogLevelWarning`).
 */
import {
  CLIENT_INFO_META_KEY,
  isJSONRPCRequest,
  type JSONRPCRequest,
} from "@modelcontextprotocol/server"
import type { Hono } from "hono"
import type { RefusedRequest } from "./http-edge.js"

export const REQUEST_LOG_LEVEL_ENV_VAR = "MCP_LOG_LEVEL"
const LEVELS = ["info", "debug", "trace"] as const
export type RequestLogLevel = (typeof LEVELS)[number]

const isLevel = (value: string): value is RequestLogLevel =>
  (LEVELS as readonly string[]).includes(value)

/** `MCP_LOG_LEVEL` as the log reads it: a known level in any case, else `info`. */
export function requestLogLevel(env: NodeJS.ProcessEnv): RequestLogLevel {
  const raw = env[REQUEST_LOG_LEVEL_ENV_VAR]?.trim().toLowerCase() ?? ""
  return isLevel(raw) ? raw : "info"
}

/**
 * Above `info` the log carries tool arguments and results (process variables, business keys), at
 * `trace` every header and body too: the boot says so. An unknown level logs at `info` and says that.
 */
export function requestLogLevelWarning(env: NodeJS.ProcessEnv): string | undefined {
  const raw = env[REQUEST_LOG_LEVEL_ENV_VAR]?.trim()
  if (!raw) return undefined
  const level = raw.toLowerCase()
  if (!isLevel(level)) {
    return `${REQUEST_LOG_LEVEL_ENV_VAR}=${raw} is not a level (${LEVELS.join(", ")}): the request log stays at info.`
  }
  if (level === "debug") {
    return `${REQUEST_LOG_LEVEL_ENV_VAR}=debug: the request log shows tool arguments and results (process variables, business keys) on every call. For debugging only.`
  }
  if (level === "trace") {
    return `${REQUEST_LOG_LEVEL_ENV_VAR}=trace: the request log shows every request and response in full, bodies included (credential headers redacted). For debugging only.`
  }
  return undefined
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

// Control, format and line-separator characters would let a caller forge log lines or reorder them
// on screen.
const sanitize = (value: string) => value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "?")

const ERROR_TEXT_MAX = 500
const PATH_MAX = 200
const INLINE_MAX = 80
const DUMP_MAX = 10_000

const cut = (value: string, max: number) => (value.length > max ? `${value.slice(0, max)}…` : value)

/** Paths are the caller's: one line each, whatever they hold, and of a bounded length. */
const loggedPath = (path: string) => cut(sanitize(path), PATH_MAX)

function clientInfo(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.name !== "string") return undefined
  return typeof value.version === "string" && value.version
    ? `${value.name}/${value.version}`
    : value.name
}

/** The per-request envelope (2026-07-28), else the `initialize` handshake's `clientInfo`. */
function clientOf(request: JSONRPCRequest): string | undefined {
  const params = isRecord(request.params) ? request.params : {}
  const meta = isRecord(params._meta) ? params._meta : {}
  return (
    clientInfo(meta[CLIENT_INFO_META_KEY]) ??
    (request.method === "initialize" ? clientInfo(params.clientInfo) : undefined)
  )
}

/** What the line names next to the method, and what `debug` echoes as its input. */
function detailOf(request: JSONRPCRequest): { subject?: string; input?: unknown } {
  const params = isRecord(request.params) ? request.params : {}
  switch (request.method) {
    case "initialize":
      return { subject: clientInfo(params.clientInfo) }
    case "tools/call":
    case "prompts/get":
      return { subject: text(params.name), input: params.arguments }
    case "resources/read":
    case "resources/subscribe":
    case "resources/unsubscribe":
      return { subject: text(params.uri) }
    case "logging/setLevel":
      return { subject: text(params.level) }
    case "completion/complete": {
      const ref = isRecord(params.ref) ? params.ref : {}
      return { subject: text(ref.name) ?? text(ref.uri), input: params.argument }
    }
    default:
      return {}
  }
}

interface Described {
  /** The JSON-RPC method, `batch(a,b)`, or the HTTP method. */
  label: string
  first?: JSONRPCRequest
}

function describe(httpMethod: string, body: unknown): Described {
  const requests = (Array.isArray(body) ? body : [body]).filter(isJSONRPCRequest)
  const [first] = requests
  if (!first) return { label: httpMethod }
  const label =
    requests.length === 1
      ? sanitize(first.method)
      : `batch(${requests.map(({ method }) => sanitize(method)).join(",")})`
  return { label, first }
}

interface Outcome {
  error?: string
  result?: unknown
}

const blocksOf = (result: Json): unknown[] | undefined =>
  Array.isArray(result.content) ? (result.content as unknown[]) : undefined

function toolErrorText(result: Json): string {
  const blocks = blocksOf(result) ?? []
  const block = blocks.find((item) => isRecord(item) && item.type === "text")
  return text(isRecord(block) ? block.text : undefined) ?? "tool error"
}

/** One message's outcome: `undefined` when it carries neither an error nor a result. */
function messageOutcome(message: unknown): Outcome | undefined {
  if (!isRecord(message)) return undefined
  const { error } = message
  if (isRecord(error) && typeof error.message === "string") return { error: error.message }
  // An OAuth refusal (RFC 6750): `{ error, error_description }`.
  if (typeof error === "string") {
    const description = text(message.error_description)
    return { error: description ? `${error}: ${description}` : error }
  }
  if (isRecord(message.result) && message.result.isError === true) {
    return { error: toolErrorText(message.result) }
  }
  return "result" in message ? { result: message.result } : undefined
}

/** The first error of a JSON or SSE body, else the last result (what `debug` echoes). */
function outcomeOf(body: string, sse: boolean): Outcome {
  const payloads = sse
    ? body
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
    : [body]
  let outcome: Outcome = {}
  for (const payload of payloads) {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      continue
    }
    for (const message of Array.isArray(parsed) ? parsed : [parsed]) {
      const found = messageOutcome(message)
      if (found?.error !== undefined) return found
      if (found) outcome = found
    }
  }
  return outcome
}

/**
 * Whether a body can hold what `info` names, an `error` key (JSON-RPC, OAuth) or a tool's
 * `isError`. A quote inside a JSON string is escaped, so the view document a `resources/read`
 * returns (the whole bundle, a megabyte) is neither decoded nor parsed, which would cost a view
 * read a fifth of its time; a stray match only costs the parse.
 */
const mayCarryError = (body: Buffer) => body.includes('"error"') || body.includes('"isError"')

/** A tool result as `debug` shows it: its structured content, a lone text, or its blocks. */
function compactResult(result: unknown): unknown {
  if (!isRecord(result)) return result
  if (result.structuredContent !== undefined) return result.structuredContent
  const blocks = blocksOf(result)
  const [only] = blocks ?? []
  if (blocks?.length === 1 && isRecord(only) && only.type === "text") return only.text
  return blocks
}

function inline(value: unknown): string {
  let rendered: string
  try {
    rendered = JSON.stringify(value) ?? String(value)
  } catch {
    rendered = String(value)
  }
  return sanitize(cut(rendered, INLINE_MAX))
}

const REDACTED = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
])

const headerDump = (headers: Headers): Json =>
  Object.fromEntries(
    [...headers].map(([name, value]) => [name, REDACTED.has(name) ? "[REDACTED]" : value]),
  )

function dumpBody(body: unknown): string {
  if (body === undefined) return "(none)"
  const rendered = typeof body === "string" ? body : JSON.stringify(body, null, 2)
  return cut(rendered, DUMP_MAX)
}

/** What the log reads off hono's context once the response is there. */
interface Answered {
  req: { raw: Request }
  res: Response
  error: Error | undefined
}

interface Exchange {
  started: number
  path: string
  described: Described
  requestBody: unknown
}

function summaryLine(
  c: Answered,
  { started, path, described }: Exchange,
  outcome: Outcome,
  level: RequestLogLevel,
): string {
  const { label, first } = described
  const status = c.res.status
  const parts: (string | number)[] = [label]
  if (first) {
    const { subject, input } = detailOf(first)
    if (subject) parts.push(sanitize(subject))
    parts.push(path, status, `client=${sanitize(clientOf(first) ?? "unknown")}`)
    parts.push(`${Date.now() - started}ms`)
    if (level !== "info" && input !== undefined) parts.push(inline(input))
    if (level !== "info" && first.method === "tools/call" && outcome.result !== undefined) {
      parts.push("->", inline(compactResult(outcome.result)))
    }
  } else {
    parts.push(path, status, `${Date.now() - started}ms`)
  }
  const error = c.error?.message ?? outcome.error
  if (error !== undefined) parts.push(`ERROR ${sanitize(cut(error, ERROR_TEXT_MAX))}`)
  else if (status >= 400 && first) parts.push(`ERROR (HTTP ${status})`)
  return parts.join(" ")
}

function traceDump(c: Answered, exchange: Exchange, responseBody: string | undefined): string {
  return [
    `[trace] request headers ${JSON.stringify(headerDump(c.req.raw.headers), null, 2)}`,
    `[trace] request body ${dumpBody(exchange.requestBody)}`,
    `[trace] response headers ${JSON.stringify(headerDump(c.res.headers), null, 2)}`,
    `[trace] response body ${responseBody === undefined ? "(not read)" : dumpBody(responseBody)}`,
  ].join("\n")
}

const mediaType = (response: Response) =>
  response.headers.get("content-type")?.split(";")[0].trim().toLowerCase()

/** Reading a long-lived stream would never end, so only a request's own answer is read. */
const isStream = (response: Response) => mediaType(response) === "text/event-stream"

/**
 * What the line reads the outcome of: an MCP request's answer (but never the open stream of
 * `subscriptions/listen`), and any other refusal in JSON (the edge guard's 403, a 405), so a
 * refused request names its reason too.
 */
function answerToRead(response: Response, first: JSONRPCRequest | undefined): boolean {
  if (!response.body) return false
  if (first) return first.method !== "subscriptions/listen"
  return response.status >= 400 && mediaType(response) === "application/json"
}

/** The stateless server's answer to a client asking for a stream or a session: no failure. */
const isExpectedRefusal = (method: string, path: string, mcpPath: string, status: number) =>
  status === 405 && path === mcpPath && (method === "GET" || method === "DELETE")

/** No absolute target (`http://user:pw@h`), and no authority a URL parser reads off `//` or `/\`. */
const ORIGIN_FORM = /^\/(?![/\\])/

/**
 * The line of a request the listener answered, which `installRequestLog` never sees. Without its
 * query or fragment, like every other line, which either can carry a token; a target that is no
 * path is left out whole, since it can carry credentials.
 */
export function logRefusedRequest({ method, target, status, message }: RefusedRequest): void {
  const shown = ORIGIN_FORM.test(target)
    ? loggedPath(target.split(/[?#]/, 1)[0])
    : "(not origin-form)"
  console.log(`${method} ${shown} ${status} 0ms ERROR ${message}`)
}

export function installRequestLog(
  app: Hono,
  mcpPath: string,
  level: RequestLogLevel = "info",
): void {
  app.use("*", async (c, next) => {
    const started = Date.now()
    const { method, path } = c.req
    let requestBody: unknown
    if (method === "POST" && path === mcpPath) {
      requestBody = await c.req.raw
        .clone()
        .json()
        .catch(() => undefined)
    }
    const exchange: Exchange = {
      started,
      path: loggedPath(path),
      described: describe(method, requestBody),
      requestBody,
    }
    await next()
    const { first } = exchange.described
    const finish = (bytes: ArrayBuffer | undefined, sse: boolean) => {
      const read = bytes && Buffer.from(bytes)
      // `info` names only an error; `debug` and `trace` echo a tool's result too.
      const body = read && (level !== "info" || mayCarryError(read)) ? read.toString() : undefined
      const line = summaryLine(c, exchange, body === undefined ? {} : outcomeOf(body, sse), level)
      // stdout, one write: the trace dump follows its line without another request in between.
      console.log(level === "trace" ? `${line}\n${traceDump(c, exchange, body)}` : line)
    }
    if (isExpectedRefusal(method, path, mcpPath, c.res.status) || !answerToRead(c.res, first)) {
      finish(undefined, false)
      return
    }
    const bytes = c.res.clone().arrayBuffer()
    if (isStream(c.res)) {
      // Never awaited: the client reads the original as it is written.
      void bytes.then(
        (read) => finish(read, true),
        () => finish(undefined, true),
      )
      return
    }
    finish(await bytes.catch(() => undefined), false)
  })
}
