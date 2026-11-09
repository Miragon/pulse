/**
 * Typed engine-call failures. hey-api throws whatever the engine sent (the
 * parsed `ExceptionDto` object for a JSON error body, the raw text otherwise,
 * `{}` for an empty body) and a bare `TypeError("fetch failed")` for network
 * failures. None of that is an `Error` carrying a readable message, so every
 * engine 4xx/5xx used to reach the model as "[object Object]". The client's
 * always-on error interceptor ([[createEngineClient]]) funnels every failure
 * through {@link toEngineRequestError} instead.
 */

/**
 * What went wrong: an engine error response, no connection to the engine, a
 * connection that failed mid-request, the deadline, or the caller.
 */
export type EngineFailureKind = "http" | "unreachable" | "connection" | "timeout" | "cancelled"

/** Upper bound for engine-supplied text in the message (stack traces, HTML error pages). */
const MAX_ENGINE_TEXT = 500

/** An `ExceptionDto.type` worth echoing: a (qualified) Java class name, nothing longer. */
const EXCEPTION_TYPE = /^[\w$.]{1,120}$/

/**
 * An engine call that failed, with a model-actionable `message`:
 *
 * - `[404 InvalidRequestException] Process instance with id x does not exist (engine prod-a)`
 * - `[500] Internal Server Error — empty response body (engine prod-a)`
 * - `engine prod-a unreachable (ECONNREFUSED)`
 * - `connection to engine prod-a failed (UND_ERR_SOCKET) — the POST may still have been applied; …`
 * - `engine prod-a did not respond within 30000 ms (timeout)`
 *
 * The HTTP status is `httpStatus`, deliberately NOT `status` (and the
 * engine's numeric error code is `engineCode`, not `code`): widget-shell's
 * `withToolErrors` prefixes any `status`/`code` property as `[…] `, which
 * would print the status twice. The message is complete on its own.
 */
export class EngineRequestError extends Error {
  readonly kind: EngineFailureKind
  /** HTTP status of the engine's error response; `undefined` when none arrived. */
  readonly httpStatus?: number
  /** The engine's exception class (`ExceptionDto.type`), e.g. `InvalidRequestException`. */
  readonly type?: string
  /** The engine's own message (or the truncated body / failure detail), undecorated. */
  readonly engineMessage: string
  /** The engine's numeric error code (`ExceptionDto.code`), when it sent one. */
  readonly engineCode?: number
  /** Id of the configured engine the request went to, when the client knows it. */
  readonly engineId?: string

  constructor(
    message: string,
    details: {
      kind: EngineFailureKind
      engineMessage: string
      httpStatus?: number
      type?: string
      engineCode?: number
      engineId?: string
      cause?: unknown
    },
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause })
    this.name = "EngineRequestError"
    this.kind = details.kind
    this.httpStatus = details.httpStatus
    this.type = details.type
    this.engineMessage = details.engineMessage
    this.engineCode = details.engineCode
    this.engineId = details.engineId
  }
}

/**
 * Every form a credential can take in echoed text: as configured, trimmed
 * (header values are sent trimmed) and whitespace-collapsed. Longest first,
 * so a value is masked whole before any shorter one inside it. Values under
 * 4 characters are skipped: masking those would shred ordinary text.
 */
function secretForms(secrets: ReadonlyArray<string | undefined>): string[] {
  const forms = new Set<string>()
  for (const secret of secrets) {
    if (!secret) continue
    for (const form of [secret, secret.trim(), secret.replace(/\s+/g, " ").trim()]) {
      if (form.length >= 4) forms.add(form)
    }
  }
  return [...forms].sort((a, b) => b.length - a.length)
}

function mask(text: string, secrets: readonly string[]): string {
  let masked = text
  for (const secret of secrets) masked = masked.split(secret).join("***")
  return masked
}

/**
 * Engine-supplied text made safe for the model: credentials masked (before
 * AND after collapsing whitespace, so neither form slips through), then
 * capped at {@link MAX_ENGINE_TEXT}.
 */
function clip(text: string, secrets: readonly string[]): string {
  const flat = mask(mask(text, secrets).replace(/\s+/g, " ").trim(), secrets)
  return flat.length > MAX_ENGINE_TEXT ? `${flat.slice(0, MAX_ENGINE_TEXT)}…` : flat
}

function stringField(value: unknown, key: string): string | undefined {
  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" && field.length > 0 ? field : undefined
}

/**
 * The engine-side detail of an error response: hey-api hands the error
 * interceptor the parsed JSON body, else the raw text (`""` when empty).
 */
function describeBody(
  body: unknown,
  response: Response,
  secrets: readonly string[],
): { type?: string; engineMessage: string; engineCode?: number } {
  let type: string | undefined
  let engineCode: number | undefined
  let text: string
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    // ExceptionDto {type, message, code}; `error` covers proxies/gateways. A
    // `type` that is no class name (a proxy's free text) is dropped.
    const rawType = stringField(body, "type")
    type = rawType && EXCEPTION_TYPE.test(rawType) ? mask(rawType, secrets) : undefined
    const code = (body as Record<string, unknown>).code
    engineCode = typeof code === "number" ? code : undefined
    const message = stringField(body, "message") ?? stringField(body, "error")
    text = message ?? (Object.keys(body).length > 0 ? JSON.stringify(body) : "")
  } else {
    text = typeof body === "string" ? body : body == null ? "" : JSON.stringify(body)
  }
  const engineMessage = clip(text, secrets)
  if (engineMessage) return { type, engineMessage, engineCode }
  const statusText = clip(response.statusText, secrets)
  return {
    type,
    engineCode,
    engineMessage: statusText ? `${statusText} — empty response body` : "empty response body",
  }
}

/** The OS-level failure code of a fetch network error (`ECONNREFUSED`, `ENOTFOUND`, …). */
function networkCode(error: TypeError): string {
  const cause = error.cause as { code?: unknown; errors?: Array<{ code?: unknown }> } | undefined
  const code = cause?.code ?? cause?.errors?.find((e) => e.code)?.code
  return typeof code === "string" && code.length > 0 ? code : "network error"
}

export interface EngineErrorContext {
  /** The engine's error response; `undefined` when none arrived. */
  response?: Response
  /** The request as sent (after the client's own interceptors). */
  request?: Request
  /** Engine id for the message suffix; omitted when unknown. */
  engineId?: string
  /** The per-request deadline, for the timeout message. */
  timeoutMs: number
  /** Whether THIS client's deadline (not a caller signal) aborted the request. */
  timedOut: boolean
  /** Appended as a sentence to 401 messages (auth-type-specific remedy). */
  unauthorizedHint?: string
  /** Credentials the request carried, masked wherever engine text is echoed. */
  secrets?: ReadonlyArray<string | undefined>
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

/**
 * Network failures before a connection exists (DNS, refused, no route,
 * connect timeout): the engine cannot have seen the request. Any other one
 * (a reset or closed socket) may come after the engine received it.
 */
const CONNECT_PHASE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
])

/**
 * The engine's POST QUERIES the connector reads through: a POST only
 * because the query has a body (`POST /job` takes a sort over two keys, its
 * GET twin only one). Reads: a failure carries no write caveat. Matched as
 * the path's last segment(s) below the REST root.
 */
const POST_QUERY_PATHS = ["/job"]

/** Whether `request` only reads: a safe method, or one of the engine's POST queries. */
function isRead(request: Request): boolean {
  if (SAFE_METHODS.has(request.method)) return true
  if (request.method !== "POST") return false
  const path = new URL(request.url).pathname.replace(/\/+$/, "")
  return POST_QUERY_PATHS.some((query) => path.endsWith(query))
}

/** The caveat for a write whose outcome is unknown; empty for reads. */
function writeCaveat(request: Request): string {
  return isRead(request)
    ? ""
    : ` — the ${request.method} may still have been applied; check the current state before retrying`
}

/** An aborted request: this client's deadline, or the caller's signal. */
function abortError(error: unknown, request: Request, ctx: EngineErrorContext) {
  const engine = ctx.engineId ? `engine ${ctx.engineId}` : "engine"
  if (!ctx.timedOut) {
    return new EngineRequestError(`request to ${engine} was cancelled by the caller`, {
      kind: "cancelled",
      engineMessage: "cancelled by the caller",
      engineId: ctx.engineId,
      cause: error,
    })
  }
  return new EngineRequestError(
    `${engine} did not respond within ${ctx.timeoutMs} ms (timeout)${writeCaveat(request)}`,
    {
      kind: "timeout",
      engineMessage: `no response within ${ctx.timeoutMs} ms`,
      engineId: ctx.engineId,
      cause: error,
    },
  )
}

/** Longest redirect target the message names. */
const MAX_REDIRECT_TARGET = 200

/**
 * Where a 3xx points, as origin and path only: a login page's query (a return URL, a state)
 * says nothing the operator needs and may carry more than they should read.
 */
function redirectTarget(response: Response, secrets: readonly string[]): string | undefined {
  const location = response.headers.get("Location")
  if (!location || !URL.canParse(location, response.url || undefined)) return undefined
  const target = new URL(location, response.url || undefined)
  const shown = clip(`${target.origin}${target.pathname}`, secrets)
  return shown.length > MAX_REDIRECT_TARGET ? `${shown.slice(0, MAX_REDIRECT_TARGET)}…` : shown
}

/**
 * A 3xx: the client never follows one (a followed 302/303 turns a write into a GET), so the
 * request was not applied, and the message says what to fix.
 */
function redirectError(response: Response, ctx: EngineErrorContext) {
  const target = redirectTarget(response, secretForms(ctx.secrets ?? []))
  const engineMessage = target ? `redirect to ${target}` : "redirect"
  const suffix = ctx.engineId ? ` (engine ${ctx.engineId})` : ""
  return new EngineRequestError(
    `[${response.status}] ${engineMessage}${suffix}. The engine URL redirects, and redirects are ` +
      "never followed: point the engine URL at the REST API root itself (e.g. https:// when the " +
      "server redirects from http://). A redirect to a login page means the engine credentials " +
      "are missing or expired.",
    { kind: "http", httpStatus: response.status, engineMessage, engineId: ctx.engineId },
  )
}

/**
 * A 404 that is no engine answer: no exception type (a servlet container's or a proxy's page) or
 * the JAX-RS `NotFoundException` of a path the REST API does not serve, most likely a wrong REST
 * root. Wording only, restated from c7-core's `isUnknownEndpoint` (this leaf cannot import
 * it); the engine connector holds the two equal (`src/lib/core-adapter/engine-port.test.ts`).
 */
function isUnknownEndpoint(status: number, type: string | undefined): boolean {
  return status === 404 && (type === undefined || type === "NotFoundException")
}

const UNKNOWN_ENDPOINT_HINT =
  "No such endpoint: check that the engine URL points at the REST API root itself " +
  "(e.g. http://localhost:8080/engine-rest)."

/** The sentence a status needs beyond the engine's own text, or "". */
function hintOf(status: number, type: string | undefined, ctx: EngineErrorContext): string {
  if (status === 401 && ctx.unauthorizedHint) return `. ${ctx.unauthorizedHint}`
  return isUnknownEndpoint(status, type) ? `. ${UNKNOWN_ENDPOINT_HINT}` : ""
}

/** An engine error response: status, exception type and the (masked) engine text. */
function httpError(body: unknown, response: Response, ctx: EngineErrorContext) {
  if (response.status >= 300 && response.status < 400) return redirectError(response, ctx)
  const { type, engineMessage, engineCode } = describeBody(
    body,
    response,
    secretForms(ctx.secrets ?? []),
  )
  const suffix = ctx.engineId ? ` (engine ${ctx.engineId})` : ""
  const head = `[${response.status}${type ? ` ${type}` : ""}] ${engineMessage}${suffix}`
  const hint = hintOf(response.status, type, ctx)
  return new EngineRequestError(`${head}${hint}`, {
    kind: "http",
    httpStatus: response.status,
    type,
    engineMessage,
    engineCode,
    engineId: ctx.engineId,
  })
}

/** A network failure: no connection at all, or one that broke mid-request. */
function networkError(error: TypeError, request: Request, engineId: string | undefined) {
  const engine = engineId ? `engine ${engineId}` : "engine"
  const code = networkCode(error)
  const details = { engineMessage: code, engineId, cause: error }
  if (CONNECT_PHASE_CODES.has(code)) {
    return new EngineRequestError(`${engine} unreachable (${code})`, {
      kind: "unreachable",
      ...details,
    })
  }
  return new EngineRequestError(`connection to ${engine} failed (${code})${writeCaveat(request)}`, {
    kind: "connection",
    ...details,
  })
}

/**
 * Maps whatever a failed engine call threw to an {@link EngineRequestError}.
 * Errors that are none of these kinds (e.g. a request that could not even be
 * built) pass through unchanged: they already carry their own message.
 */
export function toEngineRequestError(error: unknown, ctx: EngineErrorContext): unknown {
  if (error instanceof EngineRequestError) return error
  const { response, request } = ctx

  // Abort first: a deadline that fires while the BODY is being read still
  // arrives with a response. The deadline aborts the request as sent (in the
  // client's fetch), the caller's signal the request itself.
  if (request && (ctx.timedOut || request.signal.aborted)) return abortError(error, request, ctx)

  if (response && !response.ok) return httpError(error, response, ctx)

  if (!response && request && error instanceof TypeError) {
    return networkError(error, request, ctx.engineId)
  }

  return error
}
