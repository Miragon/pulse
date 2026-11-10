/**
 * The CLI's side of the authorization server. Its requests go out through
 * @miragon/pulse-http/oauth on the command's fetch, clock and `--verbose` trace: never a
 * redirect, bounded by `--timeout`, every answer read whole (as the CLI reads an engine's), and
 * the client's own credentials always `Basic ***` in the trace, also with `--show-secrets` (the
 * trace writer cannot tell them from the engine's Bearer token), bodies never. What the server
 * answered is worded here.
 */

import type { HttpFailure, Platform } from "@miragon/pulse-http"
import type { TokenFailure, TokenLimits } from "@miragon/pulse-http/oauth"
import { redactUrl } from "../../config/redact.js"
import { PulseCliError } from "../../errors.js"
import { failureDetail } from "../../http/client.js"
import type { OAuthDeps } from "./types.js"

/** Where the requests go, for messages: the issuer or endpoint and where it was configured. */
export interface Endpoint {
  readonly url: string
  /** `PULSE_CLI_OAUTH_ISSUER`, `auth.issuer of profile "p"`, ... */
  readonly source: string
}

/** A status line's parts, of an answer or of a failure that had one. */
export interface Status {
  readonly status: number
  readonly statusText: string
}

/** The outside world of the OAuth requests; it never reveals the secrets of a trace. */
export function platformOf(deps: OAuthDeps): Platform {
  const { fetch, now, trace } = deps
  return trace === undefined ? { fetch, now } : { fetch, now, trace }
}

/** `--timeout` to the last byte; no cap on an answer, as for an engine's (transport plan 2.4). */
export function limitsOf(deps: Pick<OAuthDeps, "timeoutMs">): TokenLimits {
  return { timeoutMs: deps.timeoutMs, maxAnswerBytes: Infinity }
}

/** Longest excerpt of a text from the authorization server that messages show. */
const MAX_SHOWN = 200

/** Server text as messages may show it: control characters removed, at most 200 characters. */
export function sanitize(text: string): string {
  const clean = text.replace(/\p{Cc}/gu, "")
  return clean.length > MAX_SHOWN ? `${clean.slice(0, MAX_SHOWN)}…` : clean
}

/** The URL as messages show it: without query and fragment. */
export function shownUrl(url: string): string {
  return redactUrl(url)
}

/** The status line of a failure that had an answer. */
export function statusOfFailure(failure: TokenFailure): Status {
  return { status: Number(failure.status), statusText: failure.statusText ?? "" }
}

/** Whether a failure came without an answer: no connection, or its deadline. */
export function isUnanswered(failure: TokenFailure): boolean {
  return failure.kind === "unreachable" || failure.kind === "timeout"
}

/**
 * A request to the authorization server without an answer: TIMEOUT at its deadline, else
 * NETWORK with the system code (or the most specific message) of what `fetch` threw.
 */
export function unreachable(
  failure: TokenFailure,
  method: string,
  endpoint: Endpoint,
  timeoutMs: number,
): PulseCliError {
  const timeout = failure.kind === "timeout"
  const thrown = (failure.cause as HttpFailure | undefined)?.cause
  const detail = timeout ? `timed out after ${timeoutMs} ms` : failureDetail(thrown)
  const url = shownUrl(endpoint.url)
  return new PulseCliError(
    timeout ? "TIMEOUT" : "NETWORK",
    `Cannot reach the authorization server at ${url}${detail === undefined ? "" : ` (${detail})`}`,
    {
      request: { method, url },
      hint: `Check the issuer or endpoint (${endpoint.source}) and the network; a private CA needs NODE_EXTRA_CA_CERTS.`,
    },
    failure,
  )
}

/** `503 Service Unavailable`. */
export function statusOf(answer: Status): string {
  return `${answer.status}${answer.statusText === "" ? "" : ` ${answer.statusText}`}`
}

/** `HTTP 503 Service Unavailable`. */
export function statusLine(answer: Status): string {
  return `HTTP ${statusOf(answer)}`
}
