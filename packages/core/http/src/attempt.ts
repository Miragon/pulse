/**
 * One attempt on the wire: the headers, the trace, the deadline from sending to the last byte,
 * never a redirect, and whatever `fetch` throws read as a reason.
 */
import { answerOf, type Sent } from "./answer.js"
import { beforeAbort } from "./body.js"
import type { Authorization, Credential } from "./credential.js"
import { HttpFailure } from "./failure.js"
import { MASK, maskSecrets, secretForms } from "./mask.js"
import { reasonOfCode, systemCode } from "./thrown.js"
import type { HttpAnswer, HttpRequest, Platform } from "./types.js"
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

function headersOf(
  context: Context,
  request: Prepared,
  authorization: Authorization | undefined,
): Headers | undefined {
  try {
    const headers = new Headers(context.headers)
    for (const [name, value] of Object.entries(request.headers)) headers.set(name, value)
    if (authorization !== undefined) headers.set("Authorization", authorization.header)
    if (context.userAgent !== undefined && !headers.has("User-Agent")) {
      headers.set("User-Agent", context.userAgent)
    }
    return headers
  } catch {
    // The runtime's error quotes the value it refused, which may be a secret: dropped.
    return undefined
  }
}

function trace(context: Context, sent: Sent, headers: Headers): void {
  if (context.platform.trace === undefined) return
  const shown = [...headers].map(([name, value]): [string, string] => [
    name,
    context.secretHeaders.has(name) ? MASK : maskSecrets(value, sent.forms),
  ])
  context.platform.trace({
    type: "request",
    method: sent.method,
    url: maskSecrets(sent.url, sent.forms),
    headers: Object.fromEntries(shown),
    secretHeaders: shown.map(([name]) => name).filter((name) => context.secretHeaders.has(name)),
  })
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
  const answer = await answerOf(response, sent, { cap: context.cap, signal })
  context.platform.trace?.({
    type: "response",
    status: answer.status,
    statusText: answer.statusText,
    durationMs: context.platform.now() - started,
    bytes: answer.body.byteLength,
  })
  return answer
}

/** One attempt of `request` with `authorization`. */
export async function attempt(
  context: Context,
  request: Prepared,
  authorization: Authorization | undefined,
): Promise<Attempted> {
  const headers = headersOf(context, request, authorization)
  const secrets = [...(authorization?.secrets ?? []), ...secretValues(context, headers ?? [])]
  const sent = sentOf(request, secrets)
  if (headers === undefined) {
    throw new HttpFailure("invalid-request", { ...sent, code: "header", mayHaveApplied: false })
  }
  trace(context, sent, headers)
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
