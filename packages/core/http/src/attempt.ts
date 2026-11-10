/**
 * One attempt on the wire: the headers, the trace, the deadline from sending to the last byte,
 * never a redirect, and whatever `fetch` throws read as a reason.
 */
import { answerOf, isRedirect, redirectFailure, type Sent } from "./answer.js"
import { beforeAbort } from "./body.js"
import type { Authorization, Credential } from "./credential.js"
import { HttpFailure } from "./failure.js"
import { MASK, maskSecrets, secretForms } from "./mask.js"
import { statusTextOf } from "./status.js"
import { reasonOfCode, systemCode } from "./thrown.js"
import type { HttpAnswer, HttpRequest, Platform, TraceEvent } from "./types.js"
import { targetOf } from "./url.js"

/** A connection, checked: what every attempt reads. */
export interface Context {
  readonly root: string
  readonly credential: Credential
  readonly timeoutMs: number
  readonly cap: number
  readonly headers: Readonly<Record<string, string>>
  /** Lower-case names of the headers that carry a secret. */
  readonly secretHeaders: ReadonlySet<string>
  readonly readOnly: boolean
  readonly userAgent: string | undefined
  readonly platform: Platform
}

/** A request the checks let through; `signal` only for a read. */
export interface Prepared extends Omit<HttpRequest, "signal" | "headers"> {
  readonly headers: Readonly<Record<string, string>>
  readonly signal: AbortSignal | undefined
}

export interface Attempted {
  readonly answer: HttpAnswer
  /** The secret forms of this attempt, which every text it drew is masked with. */
  readonly forms: readonly string[]
}

/** Headers whose value is a scheme and a credential (RFC 9110, 11.4): the scheme is no secret. */
const SCHEMED: ReadonlySet<string> = new Set(["authorization", "proxy-authorization"])

/**
 * The values of the secret headers among `headers`, each also without a leading word, so an
 * echo of the bare credential is found as well. An Authorization's scheme (`Bearer`, `Basic`) is
 * no secret: an echo reads `Basic ***`, as the MCP server has worded it since 0.27.
 */
export function secretValues(
  context: Pick<Context, "secretHeaders">,
  headers: Iterable<readonly [string, string]>,
): string[] {
  return [...headers]
    .filter(([name]) => context.secretHeaders.has(name.toLowerCase()))
    .flatMap(([name, value]) => {
      const bare = value.replace(/^\S+\s+/, "")
      return SCHEMED.has(name.toLowerCase()) ? [bare] : [value, bare]
    })
}

type Sending = Pick<Prepared, "method" | "url" | "intent">

/** What a request sent, masked with `forms`. */
export function sentWith(request: Sending, forms: readonly string[]): Sent {
  return { ...request, target: maskSecrets(targetOf(request.url), forms), forms }
}

/** What a request sent: its forms from its secret headers and the credential's secrets. */
export function sentOf(request: Sending, secrets: readonly string[]): Sent {
  return sentWith(request, secretForms(secrets))
}

/** A header as its caller wrote it: the name in the caller's spelling, the value as given. */
type Written = readonly [name: string, value: string]

/**
 * The headers of an attempt as their callers wrote them, in order: the connection's, the
 * request's, the credential's Authorization, then the connection's User-Agent unless one is
 * there. A later name replaces an earlier one of any case, as `Headers` merges them, and goes to
 * the end in its own spelling.
 */
function writtenHeaders(
  context: Context,
  request: Prepared,
  authorization: Authorization | undefined,
): Written[] {
  const merged = new Map<string, Written>()
  const put = (name: string, value: string): void => {
    merged.delete(name.toLowerCase())
    merged.set(name.toLowerCase(), [name, value])
  }
  for (const [name, value] of Object.entries(context.headers)) put(name, value)
  for (const [name, value] of Object.entries(request.headers)) put(name, value)
  if (authorization !== undefined) put("Authorization", authorization.header)
  if (context.userAgent !== undefined && !merged.has("user-agent")) {
    put("User-Agent", context.userAgent)
  }
  return [...merged.values()]
}

function headersOf(written: readonly Written[]): Headers | undefined {
  try {
    return new Headers(written.map(([name, value]): [string, string] => [name, value]))
  } catch {
    // The runtime's error quotes the value it refused, which may be a secret: dropped.
    return undefined
  }
}

/** A secret header's value in a trace: `***`, behind the scheme word an Authorization starts with. */
function maskedValue(name: string, value: string): string {
  const scheme = SCHEMED.has(name.toLowerCase()) ? /^\S+\s+/.exec(value)?.[0] : undefined
  return `${scheme ?? ""}${MASK}`
}

/**
 * Hands the event `build` makes to the platform's trace, built only when there is one. A trace
 * only watches: what it throws is dropped, so the attempt ends as it would without it.
 */
function emit(platform: Platform, build: () => TraceEvent): void {
  if (platform.trace === undefined) return
  try {
    platform.trace(build())
  } catch {
    // The observer's own failure, never the request's.
  }
}

/**
 * The request event of an attempt: its headers as written, each secret header's value masked and
 * every other text with the request's secrets masked, unless the platform reveals the secrets.
 */
function requestEvent(context: Context, sent: Sent, written: readonly Written[]): TraceEvent {
  const reveal = context.platform.revealSecrets === true
  const isSecret = (name: string): boolean => context.secretHeaders.has(name.toLowerCase())
  const shown = written.map(([name, value]): Written => {
    if (reveal) return [name, value]
    return [name, isSecret(name) ? maskedValue(name, value) : maskSecrets(value, sent.forms)]
  })
  return {
    type: "request",
    method: sent.method,
    url: reveal ? sent.url : maskSecrets(sent.url, sent.forms),
    headers: Object.fromEntries(shown),
    secretHeaders: written.map(([name]) => name.toLowerCase()).filter(isSecret),
  }
}

type Answered = Omit<Extract<TraceEvent, { type: "response" }>, "type" | "durationMs">

/** The response event of an attempt, timed from `started`: no trace, no second clock reading. */
function traceAnswer(context: Context, started: number, answered: Answered): void {
  emit(context.platform, () => ({
    type: "response",
    ...answered,
    durationMs: context.platform.now() - started,
  }))
}

/** What `fetch` threw, as a failure: the deadline, the caller, else the system code. */
function thrownFailure(
  error: unknown,
  sent: Sent,
  signals: Signals,
  context: Context,
): HttpFailure {
  if (error instanceof HttpFailure) return error
  const base = { method: sent.method, target: sent.target }
  const write = sent.intent !== "read"
  if (signals.deadline.aborted) {
    return new HttpFailure(
      "deadline",
      { ...base, limit: context.timeoutMs, mayHaveApplied: write },
      error,
    )
  }
  if (signals.caller?.aborted === true) {
    return new HttpFailure("cancelled", { ...base, mayHaveApplied: false }, error)
  }
  const code = systemCode(error)
  const reason = reasonOfCode(code)
  const known = code === undefined ? {} : { code }
  return new HttpFailure(
    reason,
    { ...base, ...known, mayHaveApplied: write && reason === "connection" },
    error,
  )
}

interface Signals {
  readonly deadline: AbortSignal
  readonly caller: AbortSignal | undefined
}

/** What one attempt puts on the wire. */
interface Wire {
  readonly request: Prepared
  readonly headers: Headers
  readonly sent: Sent
  readonly signals: Signals
}

/** The request on the wire, its answer read to the last byte under the deadline. */
async function onWire(context: Context, wire: Wire): Promise<HttpAnswer> {
  const { request, headers, sent, signals } = wire
  const signal = signals.caller
    ? AbortSignal.any([signals.caller, signals.deadline])
    : signals.deadline
  const started = context.platform.now()
  const body = request.body === undefined ? {} : { body: request.body }
  const init = { method: request.method, headers, redirect: "manual", signal } as const
  const response = await beforeAbort(
    context.platform.fetch(request.url, { ...init, ...body }),
    signal,
  )
  if (isRedirect(response)) {
    // Its reason phrase masked as a failure's text; its body is never read, so it has no size.
    const statusText = statusTextOf(response.status, response.statusText)
    const masked = { status: response.status, statusText: maskSecrets(statusText, sent.forms) }
    traceAnswer(context, started, masked)
    throw redirectFailure(response, sent)
  }
  const { answer, bytes } = await answerOf(response, sent, { cap: context.cap, signal })
  traceAnswer(context, started, { status: answer.status, statusText: answer.statusText, bytes })
  return answer
}

/** One attempt of `request` with `authorization`. */
export async function attempt(
  context: Context,
  request: Prepared,
  authorization: Authorization | undefined,
): Promise<Attempted> {
  const written = writtenHeaders(context, request, authorization)
  const headers = headersOf(written)
  const secrets = [...(authorization?.secrets ?? []), ...secretValues(context, written)]
  const sent = sentOf(request, secrets)
  if (headers === undefined) {
    throw new HttpFailure("invalid-request", { ...sent, code: "header", mayHaveApplied: false })
  }
  emit(context.platform, () => requestEvent(context, sent, written))
  const deadline = new AbortController()
  const timer = setTimeout(() => {
    deadline.abort()
  }, context.timeoutMs)
  const signals: Signals = { deadline: deadline.signal, caller: request.signal }
  try {
    const answer = await onWire(context, { request, headers, sent, signals })
    return { answer, forms: sent.forms }
  } catch (error) {
    throw thrownFailure(error, sent, signals, context)
  } finally {
    clearTimeout(timer)
  }
}
