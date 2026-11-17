import { WEB_CODES } from "../protocol/web.js"
import { resolveLanguage } from "./host-context.js"
import { ERROR_LABELS, type ErrorKindLabels, type ErrorSource } from "./error-labels.js"
import type { FollowUp } from "./view-host.js"

/**
 * `unreachable` covers 502/503, `timeout` 408/504, `notOnServer` an inactive module,
 * `profileRefused` an engine whose profile the server refused (ENGINE_PROFILE_REFUSED),
 * `readOnly` a write to an engine whose profile is read-only (ENGINE_READ_ONLY), `notServed` a
 * call that does not read its engine's dialect (ENGINE_DIALECT_NOT_SERVED: the server shows such
 * an engine on boards only), `signedOut` a page's call that found its session gone (the web app's
 * `signed_out`), `unknownBoard` and
 * `boardRefused` a board the server does not show (UNKNOWN_BOARD) or whose file gives none
 * (BOARD_REFUSED), and `invalidArguments` a call whose arguments the tool's input schema refuses.
 */
export const ERROR_KINDS = [
  "profileRefused",
  "readOnly",
  "notServed",
  "signedOut",
  "unknownBoard",
  "boardRefused",
  "invalidArguments",
  "unreachable",
  "timeout",
  "notOnServer",
  "unauthorized",
  "forbidden",
  "notFound",
  "failed",
  "unknown",
] as const

export type ErrorKind = (typeof ERROR_KINDS)[number]

export interface ErrorFacts {
  kind: ErrorKind
  status?: number
  source: ErrorSource
  raw: string | null
  /** The raw text without bracketed status, engine-id suffix and write caveat; null when nothing is left. */
  reason: string | null
  /** A write whose answer never came may have gone through; retrying blindly could apply it twice. */
  mayHaveApplied: boolean
}

export interface DescribedError {
  kind: ErrorKind
  /** What happened, one line ("Die Engine prod ist nicht erreichbar (HTTP 503)"). */
  title: string
  hint: string
  details: string | null
}

const BRACKET_STATUS = /\[(\d{3})(?:[\s\]])/
/** The engine id the engine client appends or leads with, or the engine module's errors quote. */
const ENGINE_ID =
  /\(engine ([^\s)]+)\)|\bengine (\S+) (?:unreachable|did not respond)|connection to engine (\S+) failed|\bEngine "([^"\s]{1,120})"/
const ENGINE = /\bengine\b|ProcessEngineException|\bCamunda\b|\bCIB seven\b/i
/**
 * The engine module's codes for an engine it does not use, and for a write it does not send. The
 * server leads its text with them; anchored, so an engine's message that quotes one is no refusal.
 */
const PROFILE_REFUSED = /^\[ENGINE_PROFILE_REFUSED\]/
const READ_ONLY = /^\[ENGINE_READ_ONLY\]/
/** The engine module's code for a call its engine's dialect does not take, anchored alike. */
const NOT_SERVED = /^\[ENGINE_DIALECT_NOT_SERVED\]/
/** The engine module's codes for a board it does not show, and for one whose file gives none. */
const UNKNOWN_BOARD = /^\[UNKNOWN_BOARD\]/
const BOARD_REFUSED = /^\[BOARD_REFUSED\]/
/** The MCP SDK's refusal of arguments the tool's input schema does not take (JSON-RPC -32602). */
const INVALID_ARGUMENTS = /^(?:MCP error -32602: )?Input validation error: /
const TOOL_MISSING = /\btool\b[^\n]*\bnot found\b|\bunknown tool\b|-32601\b|\bmethod not found\b/i
const TIMEOUT = /\(timeout\)|\btimed? ?out\b|-32001\b|did not respond within/i
const UNREACHABLE =
  /\bunreachable\b|\bconnection to \S+(?: \S+)? failed\b|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|\bfailed to fetch\b|\bfetch failed\b|\bnetworkerror\b|\bload failed\b/i
/** The engine client's caveat on a write whose outcome is unknown. */
const WRITE_CAVEAT = /the \w+ may still have been applied\b/i
const STATUS_CODE = /\[\d{3}(?:\s[^\]\n]{0,120})?\]\s*/
const LEADING_CODE = /^\[[^\]\n]{1,120}\]\s*/
const ENGINE_SUFFIX = /\(engine [^\s)]+\)$/
/** The engine id before a hint the server adds after it: "… (engine c8) The profile's url …". */
const ENGINE_BEFORE_HINT = /\(engine [^\s)]+\) (?=\p{Lu})/u
/** A sentence's end, after which the hint follows as it is. */
const SENTENCE_END = /[.!?:]$/

/** Whitespace is trimmed with trimEnd, not `\s*`: a leading `\s*` on an unanchored pattern backtracks polynomially (CodeQL js/polynomial-redos) on wire text. */

/** The text before the write caveat, without the separator that led into it. */
function withoutWriteCaveat(text: string): string {
  const caveat = WRITE_CAVEAT.exec(text)
  if (!caveat) return text
  const head = text.slice(0, caveat.index).trimEnd()
  return /[—;-]$/.test(head) ? head.slice(0, -1).trimEnd() : head
}

/**
 * The text without the engine id the server appends: at its end, or before the hint it adds,
 * which then follows the message as a sentence of its own ("No message available. The profile's
 * url must …"), never run together with it.
 */
function withoutEngineSuffix(text: string): string {
  const trimmed = text.trimEnd()
  const suffix = ENGINE_SUFFIX.exec(trimmed)
  if (suffix) return trimmed.slice(0, suffix.index).trimEnd()
  const beforeHint = ENGINE_BEFORE_HINT.exec(trimmed)
  if (!beforeHint) return text
  const message = trimmed.slice(0, beforeHint.index).trimEnd()
  const hint = trimmed.slice(beforeHint.index + beforeHint[0].length)
  if (message === "") return hint
  return `${SENTENCE_END.test(message) ? message : `${message}.`} ${hint}`
}

function reasonOf(text: string): string | null {
  const rest = withoutWriteCaveat(text)
  const code = STATUS_CODE.exec(rest)
  const words = code ? rest.slice(code.index + code[0].length) : rest.replace(LEADING_CODE, "")
  return withoutEngineSuffix(words).trim() || null
}

/** The message of whatever was thrown (an `Error`, a string, an `{ message }`). */
function rawText(error: unknown): string | null {
  if (error instanceof Error) return error.message.trim() || null
  if (typeof error === "string") return error.trim() || null
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message
    if (typeof message === "string") return message.trim() || null
  }
  return null
}

/** A numeric HTTP status on the error object (`status` / `httpStatus`), or in its text. */
function statusOf(error: unknown, text: string): number | undefined {
  if (typeof error === "object" && error !== null) {
    for (const key of ["httpStatus", "status"] as const) {
      const value = (error as Record<string, unknown>)[key]
      if (typeof value === "number" && value >= 100 && value <= 599) return value
    }
  }
  const match = BRACKET_STATUS.exec(text)
  return match ? Number(match[1]) : undefined
}

function sourceOf(text: string): ErrorSource {
  const id = ENGINE_ID.exec(text)
  if (id) return { type: "engine", id: id[1] ?? id[2] ?? id[3] ?? id[4] }
  if (ENGINE.test(text)) return { type: "engine" }
  return { type: "unknown" }
}

function kindOfStatus(status: number): ErrorKind {
  if (status === 401) return "unauthorized"
  if (status === 403) return "forbidden"
  if (status === 404) return "notFound"
  if (status === 408 || status === 504) return "timeout"
  if (status === 502 || status === 503) return "unreachable"
  return "failed"
}

/** The server's refusals its text names, each by its code or the SDK's own words, in this order. */
const NAMED_KINDS: ReadonlyArray<readonly [RegExp, ErrorKind]> = [
  [PROFILE_REFUSED, "profileRefused"],
  [READ_ONLY, "readOnly"],
  [NOT_SERVED, "notServed"],
  [UNKNOWN_BOARD, "unknownBoard"],
  [BOARD_REFUSED, "boardRefused"],
  [INVALID_ARGUMENTS, "invalidArguments"],
  [TOOL_MISSING, "notOnServer"],
]

/** The web app's code on a page's refusal (`WebApiError.code`), which no text carries. */
function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null
    ? (error as { code?: unknown }).code
    : undefined
}

function kindOf(text: string, status: number | undefined): ErrorKind {
  const named = NAMED_KINDS.find(([pattern]) => pattern.test(text))
  if (named) return named[1]
  if (status !== undefined) return kindOfStatus(status)
  if (TIMEOUT.test(text)) return "timeout"
  if (UNREACHABLE.test(text)) return "unreachable"
  return "unknown"
}

/** The wire carries text only, so the facts are read from it. Pure: no words, no locale. */
export function classifyError(error: unknown): ErrorFacts {
  const raw = rawText(error)
  const text = raw ?? ""
  const status = statusOf(error, text)
  return {
    kind: codeOf(error) === WEB_CODES.signedOut ? "signedOut" : kindOf(text, status),
    ...(status !== undefined ? { status } : {}),
    source: sourceOf(text),
    raw,
    reason: reasonOf(text),
    mayHaveApplied: WRITE_CAVEAT.test(text),
  }
}

/**
 * The server's refusals no retry changes: it refuses at once and keeps refusing until its operator
 * changes the profile or the board file, the user signs in again, or the call asks otherwise. A
 * refused profile fails every read and write to its engine; a read-only one fails only writes,
 * which the view's data layer never retries anyway; a call that does not read its engine's
 * dialect fails alike on every try; a page whose session ended fails every call
 * until its user signs in again; a board the server does not show, and arguments the tool does
 * not take, fail the same call alike every time.
 */
const PERMANENT_KINDS: ReadonlySet<ErrorKind> = new Set([
  "profileRefused",
  "readOnly",
  "notServed",
  "signedOut",
  "unknownBoard",
  "boardRefused",
  "invalidArguments",
])

/** A failure the view neither retries by itself nor offers Try again for: its hint says the way out. */
export function isPermanentError(error: unknown): boolean {
  return PERMANENT_KINDS.has(classifyError(error).kind)
}

/**
 * A page's call that found its session gone (the web app's `signed_out`). The page's frame says
 * so, once, with its sign-in: a view's own states step back from it (no error box, no strip, no
 * footer alert), and it says nothing about an engine, which no call reached.
 */
export function isSessionEnded(error: unknown): boolean {
  return classifyError(error).kind === "signedOut"
}

/**
 * The refusals whose words on a page lead to its start page: what the page asked for is not
 * there (a board, an argument, a module, a view of an engine the server shows on boards only),
 * so its state links there where the host has one.
 */
const START_PAGE_KINDS: ReadonlySet<ErrorKind> = new Set([
  "notServed",
  "unknownBoard",
  "invalidArguments",
  "notOnServer",
])

export function leadsToStartPage(kind: ErrorKind): boolean {
  return START_PAGE_KINDS.has(kind)
}

export interface DescribeErrorOptions {
  fallbackTitle?: string
  /**
   * What the host does with a hand-off (`ViewHost.followUp`), which says where the view sits: a
   * chat's words (`chat`, the default) may send the reader there, a page's (`copy`, `none`) say
   * what to do on the page, as the view frame's do.
   */
  followUp?: FollowUp
}

/** Never the raw "[503 ProcessEngineException] …" as the headline; feed the result to pulse-ui's `ErrorState`. */
export function describeError(
  error: unknown,
  locale: string | undefined,
  options: DescribeErrorOptions = {},
): DescribedError {
  const labels = ERROR_LABELS[resolveLanguage(locale)]
  const facts = classifyError(error)
  const words: ErrorKindLabels = labels[facts.kind]
  const source = labels.source({ source: facts.source })
  const status = facts.status === undefined ? "" : labels.status({ status: facts.status })
  const title =
    facts.kind === "unknown" && options.fallbackTitle
      ? options.fallbackTitle
      : words.title({ source, status })
  const page = (options.followUp ?? "chat") !== "chat"
  return {
    kind: facts.kind,
    title,
    hint: words.hint({ source: facts.source.type, page }),
    details: facts.raw,
  }
}
