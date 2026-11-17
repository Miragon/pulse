/**
 * What the model reads when an engine call fails. The transport (@miragon/pulse-http) gives the
 * reason as data (`HttpFailure`) and masks the request's secrets in every text the engine sent
 * back; hey-api hands an error answer's parsed body to the client's error interceptor. Both
 * become an {@link EngineRequestError} here, worded for the model: the engine by its id, never
 * its URL, the engine's own text cut at 500 characters, the write caveat only where the transport
 * says a write may have applied. Every engine call of the module goes through this one wording
 * (`createEngineConnection` installs it), the read composites' included.
 */

import { failureOf, isUnknownEndpoint } from "@miragon/pulse-c7-core"
import {
  decodeText,
  type FailureReason,
  HttpFailure,
  type HttpAnswer,
  type Intent,
  STATUS_TEXT,
} from "@miragon/pulse-http"

/**
 * What went wrong: an engine error answer, no connection, one that failed mid-request, the
 * deadline, the caller, an answer above the size cap, or a request refused before sending.
 */
export type EngineFailureKind =
  "http" | "unreachable" | "connection" | "tls" | "timeout" | "cancelled" | "too-large" | "refused"

/**
 * An engine call that failed, with a model-actionable `message`:
 *
 * - `[404 InvalidRequestException] Process instance with id x does not exist (engine prod-a)`
 * - `[500] empty response body (engine prod-a)`
 * - `engine prod-a unreachable (ECONNREFUSED)`
 * - `connection to engine prod-a failed (UND_ERR_SOCKET) — the POST may still have been applied; …`
 * - `engine prod-a did not respond within 30000 ms (timeout)`
 *
 * The HTTP status is `httpStatus`, deliberately NOT `status` (and the engine's numeric error code
 * is `engineCode`, not `code`): widget-shell's `withToolErrors` prefixes any `status`/`code`
 * property as `[…] `, which would print the status twice. The message is complete on its own.
 */
export class EngineRequestError extends Error {
  readonly kind: EngineFailureKind
  /** HTTP status of the engine's error answer; `undefined` when none arrived. */
  readonly httpStatus?: number
  /** The engine's exception class (`ExceptionDto.type`), e.g. `InvalidRequestException`. */
  readonly type?: string
  /** The engine's own message (or the cut body / failure detail), undecorated. */
  readonly engineMessage: string
  /** The engine's numeric error code (`ExceptionDto.code`), when it sent one. */
  readonly engineCode?: number
  /** Id of the configured engine the request went to. */
  readonly engineId: string

  constructor(
    message: string,
    details: {
      kind: EngineFailureKind
      engineMessage: string
      engineId: string
      httpStatus?: number
      type?: string
      engineCode?: number
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

export interface EngineErrorContext {
  /** Id of the configured engine: every message names it. */
  readonly engineId: string
  /** The sentence a 401 adds (`unauthorizedHint` of credentials.ts). */
  readonly unauthorizedHint: () => string
  /** Whether a request of the SDK only reads (the route table); a write when unset. */
  readonly intentOf?: (request: Request) => Intent
}

/** Upper bound for engine-supplied text in the message (stack traces, HTML error pages). */
const MAX_ENGINE_TEXT = 500

/** An `ExceptionDto.type` worth echoing: a (qualified) Java class name, nothing longer. */
const EXCEPTION_TYPE = /^[\w$.]{1,120}$/

/** Engine text on one line, cut at {@link MAX_ENGINE_TEXT}; the transport masked it already. */
function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > MAX_ENGINE_TEXT ? `${flat.slice(0, MAX_ENGINE_TEXT)}…` : flat
}

function stringField(value: object, key: string): string | undefined {
  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" && field.length > 0 ? field : undefined
}

/**
 * The reason phrase when it says more than the status. A standard phrase is not repeated,
 * whoever sent it: the transport fills it in for Tomcat's empty status line, so that cannot be
 * told from a proxy's own `503 Service Unavailable`. A phrase in the server's own words stays.
 */
function phraseOf(status: number, statusText: string): string {
  return statusText === STATUS_TEXT[status] ? "" : clip(statusText)
}

interface Described {
  readonly type?: string
  readonly engineMessage: string
  readonly engineCode?: number
}

/** The engine-side detail of an error answer: its parsed JSON body, else its text. */
function describeBody(body: unknown, status: number, statusText: string): Described {
  let type: string | undefined
  let engineCode: number | undefined
  let text: string
  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    // ExceptionDto {type, message, code}; `error` covers proxies and gateways. A `type` that is
    // no class name (a proxy's free text) is dropped.
    const rawType = stringField(body, "type")
    type = rawType && EXCEPTION_TYPE.test(rawType) ? rawType : undefined
    const code = (body as Record<string, unknown>).code
    engineCode = typeof code === "number" ? code : undefined
    const message = stringField(body, "message") ?? stringField(body, "error")
    text = message ?? (Object.keys(body).length > 0 ? JSON.stringify(body) : "")
  } else {
    text = typeof body === "string" ? body : body == null ? "" : JSON.stringify(body)
  }
  const engineMessage = clip(text)
  if (engineMessage) return { type, engineMessage, engineCode }
  const phrase = phraseOf(status, statusText)
  return {
    type,
    engineCode,
    engineMessage: phrase ? `${phrase} — empty response body` : "empty response body",
  }
}

const UNKNOWN_ENDPOINT_HINT =
  "No such endpoint: check that the engine URL points at the REST API root itself " +
  "(e.g. http://localhost:8080/engine-rest)."

/** The sentence a status needs beyond the engine's own text, or "". */
function hintOf(status: number, type: string | undefined, ctx: EngineErrorContext): string {
  if (status === 401) return `. ${ctx.unauthorizedHint()}`
  return isUnknownEndpoint(failureOf(status, { type })) ? `. ${UNKNOWN_ENDPOINT_HINT}` : ""
}

/**
 * An engine error answer: its status, the exception type and the engine's text. `body` is what
 * hey-api read from it: the parsed JSON, else the text.
 */
function answerError(
  answer: { readonly status: number; readonly statusText: string },
  body: unknown,
  ctx: EngineErrorContext,
): EngineRequestError {
  const { status } = answer
  const { type, engineMessage, engineCode } = describeBody(body, status, answer.statusText)
  const head = `[${String(status)}${type ? ` ${type}` : ""}] ${engineMessage} (engine ${ctx.engineId})`
  return new EngineRequestError(`${head}${hintOf(status, type, ctx)}`, {
    kind: "http",
    httpStatus: status,
    type,
    engineMessage,
    engineCode,
    engineId: ctx.engineId,
  })
}

/** An error answer as hey-api reads it: JSON when it parses, its text otherwise. */
function bodyOf(answer: HttpAnswer): unknown {
  const text = decodeText(answer)
  try {
    return (JSON.parse(text) as unknown) ?? text
  } catch {
    return text
  }
}

/** The caveat of a write whose outcome is unknown; the transport says when: never for a read. */
function caveatOf(failure: HttpFailure): string {
  return failure.mayHaveApplied
    ? ` — the ${failure.method} may still have been applied; check the current state before retrying`
    : ""
}

const codeOf = (failure: HttpFailure): string => failure.code ?? "network error"

/**
 * The transport's reasons that say nothing of an engine's dialect: no answer, a broken or slow
 * one, the caller, the size cap, a request the transport refused. Every wire of the server words
 * them alike (`transportSentence`), the Camunda 7 SDK's here and the Camunda 8 cluster's in
 * c8-errors.ts.
 */
type NeutralReason = Exclude<FailureReason, "redirect" | "unauthorized" | "status" | "credential">

/** A failure in the model's words: its kind, its engine message and its sentence. */
interface Wording {
  readonly kind: EngineFailureKind
  /** The engine message of the failure, undecorated. */
  readonly engineMessage: (failure: HttpFailure) => string
  /** The sentence the model reads, the engine named as `engine` ("engine prod-a"). */
  readonly sentence: (failure: HttpFailure, engine: string) => string
}

/** A failure whose engine message is its system code. */
const network = (
  kind: EngineFailureKind,
  words: (engine: string, code: string) => string,
): Wording => ({
  kind,
  engineMessage: codeOf,
  sentence: (failure, engine) => words(engine, codeOf(failure)) + caveatOf(failure),
})

/** A request the transport refused before sending: nothing reached the engine. */
const refusedWith = (what: (failure: HttpFailure) => string): Wording => ({
  kind: "refused",
  engineMessage: what,
  sentence: (failure, engine) => `${what(failure)}; nothing was sent (${engine})`,
})

/** Each neutral reason in the model's words, total over `NeutralReason`. */
const NEUTRAL: Readonly<Record<NeutralReason, Wording>> = {
  deadline: {
    kind: "timeout",
    engineMessage: (failure) => `no response within ${String(failure.limit)} ms`,
    sentence: (failure, engine) =>
      `${engine} did not respond within ${String(failure.limit)} ms (timeout)` + caveatOf(failure),
  },
  cancelled: {
    kind: "cancelled",
    engineMessage: () => "cancelled by the caller",
    sentence: (_, engine) => `request to ${engine} was cancelled by the caller`,
  },
  unreachable: network("unreachable", (engine, code) => `${engine} unreachable (${code})`),
  dns: network("unreachable", (engine, code) => `${engine} unreachable (${code})`),
  // The handshake failed before any request left: no write caveat, and the model may say so.
  tls: network(
    "tls",
    (engine, code) =>
      `connection to ${engine} failed (${code}): the TLS handshake failed, so nothing was sent`,
  ),
  connection: network("connection", (engine, code) => `connection to ${engine} failed (${code})`),
  "too-large": {
    kind: "too-large",
    engineMessage: (failure) => `answer above ${String(failure.limit)} bytes`,
    sentence: (failure, engine) =>
      `the answer exceeds ${String(failure.limit)} bytes, the size cap, and was not read ` +
      `(${engine})${caveatOf(failure)}`,
  },
  "invalid-answer": {
    kind: "connection",
    engineMessage: () => "no valid JSON",
    sentence: (failure, engine) => `the answer of ${engine} is no valid JSON${caveatOf(failure)}`,
  },
  "invalid-request": refusedWith((failure) => `the request cannot be sent (${codeOf(failure)})`),
  "refused-write": refusedWith(() => "the profile of this engine is read-only on this server"),
}

/** Whether `reason` says nothing of an engine's dialect (`NeutralReason`). */
function isNeutralReason(reason: FailureReason): reason is NeutralReason {
  return Object.hasOwn(NEUTRAL, reason)
}

/**
 * The model's sentence for a failure of a neutral reason, the engine by its id: the same on every
 * dialect the server reads. Undefined for a reason each dialect words itself (an answer, a
 * redirect, a credential that cannot be sent).
 */
export function transportSentence(failure: HttpFailure, engineId: string): string | undefined {
  const { reason } = failure
  return isNeutralReason(reason)
    ? NEUTRAL[reason].sentence(failure, `engine ${engineId}`)
    : undefined
}

type Worded = (failure: HttpFailure, ctx: EngineErrorContext) => EngineRequestError

/** A wording as the SDK's error: its kind, its engine message and its sentence. */
const worded =
  ({ kind, engineMessage, sentence }: Wording): Worded =>
  (failure, ctx) =>
    new EngineRequestError(sentence(failure, `engine ${ctx.engineId}`), {
      kind,
      engineMessage: engineMessage(failure),
      engineId: ctx.engineId,
      cause: failure,
    })

/** A neutral reason as the SDK's error. */
const neutral = (reason: NeutralReason): Worded => worded(NEUTRAL[reason])

/** A 3xx: never followed (a followed 302/303 turns a write into a GET), so nothing applied. */
const redirect: Worded = (failure, ctx) => {
  const engineMessage = failure.location ? `redirect to ${failure.location}` : "redirect"
  return new EngineRequestError(
    `[${String(failure.status)}] ${engineMessage} (engine ${ctx.engineId}). The engine URL ` +
      "redirects, and redirects are never followed: point the engine URL at the REST API root " +
      "itself (e.g. https:// when the server redirects from http://). A redirect to a login " +
      "page means the engine credentials are missing or expired.",
    {
      kind: "http",
      httpStatus: failure.status,
      engineMessage,
      engineId: ctx.engineId,
      cause: failure,
    },
  )
}

/** An error answer a transport call failed with (`call`, `json`); `send` answers them instead. */
const answered: Worded = (failure, ctx) =>
  answerError(
    { status: failure.status ?? 0, statusText: failure.answer?.statusText ?? "" },
    failure.answer ? bodyOf(failure.answer) : "",
    ctx,
  )

/** Each reason of the transport in the model's words, total over `FailureReason`. */
const WORDING: Readonly<Record<FailureReason, Worded>> = {
  redirect,
  unauthorized: answered,
  status: answered,
  deadline: neutral("deadline"),
  cancelled: neutral("cancelled"),
  unreachable: neutral("unreachable"),
  dns: neutral("dns"),
  tls: neutral("tls"),
  connection: neutral("connection"),
  "too-large": neutral("too-large"),
  "invalid-answer": neutral("invalid-answer"),
  "invalid-request": neutral("invalid-request"),
  "refused-write": neutral("refused-write"),
  credential: worded(
    refusedWith((failure) => `the bearer token cannot be sent (${codeOf(failure)})`),
  ),
}

/** A transport failure in the model's words. */
export function failureError(failure: HttpFailure, ctx: EngineErrorContext): EngineRequestError {
  return WORDING[failure.reason](failure, ctx)
}

/**
 * A success whose body the SDK could not read as JSON: the transport's "invalid-answer", with the
 * write caveat when the request may have changed the engine.
 */
function invalidAnswer(response: Response, request: Request, ctx: EngineErrorContext) {
  const intent = ctx.intentOf?.(request) ?? "write"
  const failure = new HttpFailure("invalid-answer", {
    method: request.method,
    target: "",
    status: response.status,
    mayHaveApplied: intent !== "read",
  })
  return failureError(failure, ctx)
}

/**
 * The client's error interceptor: whatever a failed engine call threw, as an
 * {@link EngineRequestError}. hey-api throws an error answer's parsed body (an `ExceptionDto`
 * object, the text, or `{}`), which the model would read as "[object Object]", and the
 * `SyntaxError` of a success that is no JSON; the transport throws an `HttpFailure`. Errors that
 * are none of these (a request that could not even be built) pass through unchanged: they carry
 * their own message.
 */
export function toEngineToolError(
  error: unknown,
  response: Response | undefined,
  ctx: EngineErrorContext,
  request?: Request,
): unknown {
  if (error instanceof EngineRequestError) return error
  if (error instanceof HttpFailure) return failureError(error, ctx)
  if (response && !response.ok) return answerError(response, error, ctx)
  if (error instanceof SyntaxError && response && request) {
    return invalidAnswer(response, request, ctx)
  }
  return error
}
