/**
 * The CLI's engine client: every engine request goes out through @miragon/pulse-http, which holds
 * the rules of the wire (the deadline to the last byte, no redirect, one retry after a 401 when
 * the credential renewed, the request's secrets masked in what the engine sends back), and every
 * failure is worded here, with the CLI's flags, variables and exit codes.
 */

import {
  type Connection,
  createHttp,
  type FailureReason,
  type Http,
  HttpFailure,
  type Platform,
} from "@miragon/pulse-http"
import type { AuthProvider } from "../auth/types.js"
import { PulseCliError } from "../errors.js"
import { isRecord, isSecretHeader } from "../util.js"
import { redirectError } from "./errors.js"
import type { HttpRequest, HttpResponse, TraceEvent } from "./types.js"

/** What a command's session resolved for its engine requests (`clientOf` in src/cli/session.ts). */
export interface ClientOptions {
  /** The REST API root, checked by the configuration (`validateUrl`). */
  readonly url: string
  readonly fetch: typeof globalThis.fetch
  readonly auth: AuthProvider
  readonly timeoutMs: number
  readonly now: () => number
  /** The extra headers (-H, PULSE_CLI_HEADERS, the profile): the secret ones are masked too. */
  readonly headers?: Readonly<Record<string, string>>
  /** Receives one event per request and response (`--verbose`); the CLI formats them. */
  readonly trace?: (event: TraceEvent) => void
  /** `--show-secrets`: the trace shows the secret headers (and the URL) as sent. */
  readonly showSecrets?: boolean
}

/** The client of a command: one transport for its engine and the provider that authenticates it. */
export interface Client {
  readonly http: Http
  readonly auth: AuthProvider
  readonly timeoutMs: number
}

/**
 * The session's settings as @miragon/pulse-http's connection: the URL, the provider's credential,
 * the timeout to the last byte, no cap on an answer (the CLI reads any answer whole, transport
 * plan 2.4) and the names of the secret headers among the extra ones (`isSecretHeader`).
 */
function connectionOf(options: ClientOptions): Connection {
  return {
    url: options.url,
    credential: options.auth.credential,
    timeoutMs: options.timeoutMs,
    maxAnswerBytes: Infinity,
    secretHeaders: Object.keys(options.headers ?? {}).filter(isSecretHeader),
  }
}

/**
 * The outside world of the transport. Only `--show-secrets` reveals the secrets in the trace
 * (owner decision 2026-11-10); without `--verbose` there is no trace at all.
 */
function platformOf(options: ClientOptions): Platform {
  const { fetch, now, trace } = options
  if (trace === undefined) return { fetch, now }
  return { fetch, now, trace, revealSecrets: options.showSecrets === true }
}

/**
 * The client of a command: one transport for the session's connection (transport plan,
 * Festlegung 12: the settings the CLI resolved, mapped onto the transport's `Connection`).
 */
export function createClient(options: ClientOptions): Client {
  const http = createHttp(connectionOf(options), platformOf(options))
  return { http, auth: options.auth, timeoutMs: options.timeoutMs }
}

/**
 * Sends the request. Every status is an answer; a redirect, the deadline, the network and a
 * request that cannot be sent fail as PulseCliErrors. A 401 earns one retry when the credential
 * renewed (OAuth, a token command).
 */
export async function send(request: HttpRequest, client: Client): Promise<HttpResponse> {
  const { method, url, intent, headers, body } = request
  try {
    return await client.http.send({
      method,
      url,
      intent,
      headers,
      ...(body === undefined ? {} : { body }),
    })
  } catch (error) {
    throw error instanceof HttpFailure ? failureError(error, request, client) : error
  }
}

const CERTIFICATE_ERRORS: ReadonlySet<string | undefined> = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
])

const DNS_ERRORS: ReadonlySet<string | undefined> = new Set(["ENOTFOUND", "EAI_AGAIN"])

/** Generic message of undici's fetch; the useful information is in `cause`. */
const GENERIC_FETCH_MESSAGE = "fetch failed"

function stringProperty(value: unknown, key: string): string | undefined {
  const property = isRecord(value) ? value[key] : undefined
  return typeof property === "string" && property !== "" ? property : undefined
}

/** System error code of a failed fetch: `cause.code`, or the first of `cause.errors` (AggregateError). */
function errorCode(error: unknown): string | undefined {
  const cause = isRecord(error) ? error.cause : undefined
  const first: unknown =
    isRecord(cause) && Array.isArray(cause.errors) ? (cause.errors as unknown[])[0] : undefined
  return stringProperty(cause, "code") ?? stringProperty(first, "code")
}

/** Most specific explanation of a failure: the system code, else the most specific message. */
export function failureDetail(error: unknown): string | undefined {
  const cause = isRecord(error) ? error.cause : undefined
  const message = stringProperty(cause, "message") ?? stringProperty(error, "message")
  return errorCode(error) ?? (message === GENERIC_FETCH_MESSAGE ? undefined : message)
}

/** The request a message names: its method and its URL as the CLI built it. */
interface Target {
  readonly method: string
  readonly url: string
}

/** Why undici refused to build a request: the message of the system error, else its code. */
function invalidReason(error: unknown): string | undefined {
  const cause = isRecord(error) ? error.cause : undefined
  return stringProperty(cause, "message") ?? errorCode(error)
}

function timeoutError(target: Target, timeoutMs: number, cause: unknown): PulseCliError {
  return new PulseCliError(
    "TIMEOUT",
    `Request timed out after ${timeoutMs} ms`,
    {
      request: target,
      hint: "Increase the timeout with --timeout <ms> or PULSE_CLI_TIMEOUT, or check the engine load.",
    },
    cause,
  )
}

/** A request that never reached the engine: the network, DNS or TLS failed (`error` is fetch's). */
function reachError(error: unknown, target: Target, cause: unknown = error): PulseCliError {
  const detail = failureDetail(error)
  return new PulseCliError(
    "NETWORK",
    `Cannot reach ${target.url}${detail === undefined ? "" : ` (${detail})`}`,
    { request: target, hint: networkHint(errorCode(error)) },
    cause,
  )
}

const HEADER_HINT =
  "Check the extra headers (-H, PULSE_CLI_HEADERS, the profile headers): hop-by-hop headers such as Connection, Keep-Alive, Transfer-Encoding, Upgrade and Expect are not allowed."

const URL_HINT =
  'Check the URL (--url, PULSE_CLI_URL or the profile url): pulse sends only below the REST API root, and a "." or ".." segment would name another resource.'

/**
 * Hints for what @miragon/pulse-http refuses to send, by its code (`requestUrlProblem`, a body on
 * a GET); the headers' hint for the rest.
 */
const INVALID_HINTS: Readonly<Record<string, string>> = {
  body: "A GET or HEAD request carries no body: drop --body or use another method.",
  "not-a-url": URL_HINT,
  credentials: URL_HINT,
  "outside-root": URL_HINT,
  "dot-segment": URL_HINT,
  "empty-segment": URL_HINT,
}

/** The request could not be built (undici, or the transport's own checks); nothing was sent. */
function invalidRequestError(reason: string, target: Target, cause: unknown): PulseCliError {
  return new PulseCliError(
    "USAGE",
    `Cannot send ${target.method} ${target.url}: invalid request (${reason})`,
    { request: target, hint: INVALID_HINTS[reason] ?? HEADER_HINT },
    cause,
  )
}

/** The transport refused the credential before sending (a token that is no RFC 6750 token). */
function credentialError(failure: HttpFailure, target: Target): PulseCliError {
  return new PulseCliError(
    "CONFIG",
    `Cannot send ${target.method} ${target.url}: the credential is refused (${failure.code ?? "unknown reason"})`,
    {
      request: target,
      hint: 'A bearer token is one RFC 6750 token without line breaks; a Basic username has no ":" and neither value a control character. `pulse config show` shows where each comes from.',
    },
    failure,
  )
}

/** A reason the CLI's connection never meets (see WORDING): a bug of pulse, said as one. */
function unexpectedError(failure: HttpFailure, target: Target): PulseCliError {
  return new PulseCliError(
    "INTERNAL",
    `${target.method} ${target.url} failed unexpectedly (${failure.reason})`,
    {
      request: target,
      hint: "This is likely a bug in pulse. Re-run with --verbose for the stack trace and report it at https://github.com/Miragon/pulse/issues.",
    },
    failure,
  )
}

/**
 * How the CLI words each reason of the transport; a reason the package adds fails to compile
 * here. What the CLI's connection never meets is unexpected: too-large (no cap), refused-write (it
 * is never read-only), and unauthorized, status and invalid-answer (`send` answers every status
 * and reads no JSON).
 */
const WORDING: Readonly<
  Record<FailureReason, "timeout" | "redirect" | "invalid" | "credential" | "reach" | "unexpected">
> = {
  deadline: "timeout",
  cancelled: "timeout",
  redirect: "redirect",
  "invalid-request": "invalid",
  credential: "credential",
  unreachable: "reach",
  dns: "reach",
  tls: "reach",
  connection: "reach",
  "too-large": "unexpected",
  "refused-write": "unexpected",
  unauthorized: "unexpected",
  status: "unexpected",
  "invalid-answer": "unexpected",
}

/** A request that failed without an answer, as the CLI words it. */
function failureError(failure: HttpFailure, request: HttpRequest, client: Client): PulseCliError {
  const target = { method: request.method, url: request.url }
  switch (WORDING[failure.reason]) {
    case "timeout":
      return timeoutError(target, client.timeoutMs, failure)
    case "redirect":
      return redirectError(failure, target, client.auth.loginStatusCommand)
    case "invalid":
      // undici's refusal names its reason in the error it threw; the transport's own, its code
      return invalidRequestError(
        invalidReason(failure.cause) ?? failure.code ?? "unknown reason",
        target,
        failure,
      )
    case "credential":
      return credentialError(failure, target)
    case "reach":
      return reachError(failure.cause, target, failure)
    case "unexpected":
      return unexpectedError(failure, target)
  }
}

function networkHint(code: string | undefined): string {
  if (CERTIFICATE_ERRORS.has(code)) {
    return "The TLS certificate is not trusted. Point NODE_EXTRA_CA_CERTS to your CA bundle."
  }
  if (DNS_ERRORS.has(code)) {
    return "The host name does not resolve. Check --url, PULSE_CLI_URL or your profile."
  }
  return "Is the engine running? Check --url, PULSE_CLI_URL or `pulse config show`. Run `pulse ping` to test the connection."
}
