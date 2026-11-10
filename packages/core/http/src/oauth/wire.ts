/**
 * One request to an authorization server, on the transport's own wire: the deadline to the last
 * byte, never a redirect, a size cap (1 MiB), the request's secrets (the client's, the grant's)
 * masked in the trace and in an error answer, and like a connection URL no user or password in
 * the URL. Every status is an answer, a 3xx and a refusal above the cap included (their body
 * unread); only a request without an answer, or a success above the cap, fails.
 */
import { attempt, type Context } from "../attempt.js"
import { type Authorization, noCredential } from "../credential.js"
import type { HttpFailure } from "../failure.js"
import { SECRET_HEADERS } from "../http.js"
import { decodeText } from "../problem.js"
import { statusTextOf } from "../status.js"
import type { HttpAnswer, Platform } from "../types.js"
import { TokenFailure } from "./failure.js"
import type { TokenLimits } from "./types.js"

/** The deadline of a request to an authorization server by default: 30 s. */
export const TOKEN_TIMEOUT_MS = 30_000
/** The largest answer of an authorization server by default: 1 MiB. */
export const MAX_TOKEN_ANSWER_BYTES = 1024 * 1024

/** An answer of an authorization server. */
export interface ServerAnswer {
  readonly status: number
  /** The server's reason phrase, the standard one when it sent none (always for a 3xx). */
  readonly statusText: string
  /** Names in lower case; none for a 3xx or an answer above the cap. */
  readonly headers: Readonly<Record<string, string>>
  /** The body when it is a JSON object. */
  readonly json: Readonly<Record<string, unknown>> | undefined
}

export interface ServerRequest {
  readonly method: "GET" | "POST"
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string
  /** The client's own authentication (client_secret_basic), masked wherever it could show. */
  readonly authorization?: Authorization | undefined
  /** The secrets the body carries (a client secret, a refresh token, a code), masked alike. */
  readonly secrets?: readonly string[] | undefined
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** The body as a JSON object, or undefined for anything else. */
function jsonOf(answer: HttpAnswer): Readonly<Record<string, unknown>> | undefined {
  let value: unknown
  try {
    value = JSON.parse(decodeText(answer))
  } catch {
    // No JSON: no fields.
  }
  return isRecord(value) ? value : undefined
}

/** An answer whose body was never read: a 3xx, or a refusal above the cap. */
function unread(status: number): ServerAnswer {
  return { status, statusText: statusTextOf(status, ""), headers: {}, json: undefined }
}

/** What the transport's failure means here: an unread answer, or a failure without one. */
function outcomeOf(failure: HttpFailure, url: string): ServerAnswer {
  const status = Number(failure.status)
  if (failure.reason === "redirect") return unread(status)
  if (failure.reason === "too-large") {
    // A refusal is read by its status; only a success above the cap fails as too large.
    if (status >= 400) return unread(status)
    const statusText = statusTextOf(status, "")
    throw new TokenFailure("too-large", { url, status, statusText }, failure)
  }
  const kind = failure.reason === "deadline" ? "timeout" : "unreachable"
  throw new TokenFailure(kind, { url }, failure)
}

/**
 * Refuses a URL before anything is sent, with a RangeError that names no part of it: no absolute
 * http or https URL, or one with a user or a password (it would reach the trace, and `fetch`
 * quotes it whole when it refuses it).
 */
function checkUrl(url: string): void {
  if (!URL.canParse(url)) throw new RangeError("the authorization server URL is no absolute URL")
  const { protocol, username, password } = new URL(url)
  if (protocol !== "https:" && protocol !== "http:") {
    throw new RangeError("the authorization server URL must use http or https")
  }
  if (username !== "" || password !== "") {
    throw new RangeError("the authorization server URL carries a user or a password")
  }
}

/**
 * Sends `request` once and reads its answer; see the module comment. Throws a RangeError for a
 * URL it refuses, before sending.
 */
export async function exchange(
  request: ServerRequest,
  platform: Platform,
  limits: TokenLimits = {},
): Promise<ServerAnswer> {
  checkUrl(request.url)
  const context: Context = {
    root: request.url,
    credential: noCredential,
    timeoutMs: limits.timeoutMs ?? TOKEN_TIMEOUT_MS,
    cap: limits.maxAnswerBytes ?? MAX_TOKEN_ANSWER_BYTES,
    headers: {},
    secretHeaders: new Set(SECRET_HEADERS),
    readOnly: false,
    userAgent: undefined,
    platform,
  }
  const prepared = {
    method: request.method,
    url: request.url,
    intent: request.method === "GET" ? "read" : "write",
    headers: request.headers,
    signal: undefined,
    secrets: request.secrets,
    ...(request.body === undefined ? {} : { body: request.body }),
  } as const
  try {
    const { answer } = await attempt(context, prepared, request.authorization)
    const { status, statusText, headers } = answer
    return { status, statusText, headers, json: jsonOf(answer) }
  } catch (error) {
    // `attempt` fails with an HttpFailure only.
    return outcomeOf(error as HttpFailure, request.url)
  }
}
