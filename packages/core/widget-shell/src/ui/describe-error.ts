import { supportedLanguage } from "./host-context.js"
import { ERROR_LABELS, type ErrorKindLabels, type ErrorSource } from "./error-labels.js"

export type { ErrorSource } from "./error-labels.js"

/** `unreachable` covers 502/503, `timeout` 408/504, `notOnServer` an inactive module. */
export const ERROR_KINDS = [
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
const PROMETHEUS_STATUS = /Prometheus query failed \((\d{3})\b/
/** The engine id the camunda7 client appends or leads with. */
const ENGINE_ID =
  /\(engine ([^\s)]+)\)|\bengine (\S+) (?:unreachable|did not respond)|connection to engine (\S+) failed/
const ENGINE = /\bengine\b|ProcessEngineException|\bCamunda\b|\bCIB seven\b/i
const PROMETHEUS = /\bPrometheus\b/
const TOOL_MISSING = /\btool\b[^\n]*\bnot found\b|\bunknown tool\b|-32601\b|\bmethod not found\b/i
const TIMEOUT = /\(timeout\)|\btimed? ?out\b|-32001\b|did not respond within/i
const UNREACHABLE =
  /\bunreachable\b|\bconnection to \S+(?: \S+)? failed\b|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|\bfailed to fetch\b|\bfetch failed\b|\bnetworkerror\b|\bload failed\b/i
/** The camunda7 client's caveat on a write whose outcome is unknown. */
const WRITE_CAVEAT = /the \w+ may still have been applied\b/i
const STATUS_CODE = /\[\d{3}(?:\s[^\]\n]{0,120})?\]\s*/
const LEADING_CODE = /^\[[^\]\n]{1,120}\]\s*/
const ENGINE_SUFFIX = /\(engine [^\s)]+\)$/

/** Whitespace is trimmed with trimEnd, not `\s*`: a leading `\s*` on an unanchored pattern backtracks polynomially (CodeQL js/polynomial-redos) on wire text. */

/** The text before the write caveat, without the separator that led into it. */
function withoutWriteCaveat(text: string): string {
  const caveat = WRITE_CAVEAT.exec(text)
  if (!caveat) return text
  const head = text.slice(0, caveat.index).trimEnd()
  return /[—;-]$/.test(head) ? head.slice(0, -1).trimEnd() : head
}

function withoutEngineSuffix(text: string): string {
  const trimmed = text.trimEnd()
  const suffix = ENGINE_SUFFIX.exec(trimmed)
  return suffix ? trimmed.slice(0, suffix.index).trimEnd() : text
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
  const match = BRACKET_STATUS.exec(text) ?? PROMETHEUS_STATUS.exec(text)
  return match ? Number(match[1]) : undefined
}

function sourceOf(text: string): ErrorSource {
  const id = ENGINE_ID.exec(text)
  if (id) return { type: "engine", id: id[1] ?? id[2] ?? id[3] }
  if (PROMETHEUS.test(text)) return { type: "prometheus" }
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

function kindOf(text: string, status: number | undefined): ErrorKind {
  if (TOOL_MISSING.test(text)) return "notOnServer"
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
    kind: kindOf(text, status),
    ...(status !== undefined ? { status } : {}),
    source: sourceOf(text),
    raw,
    reason: reasonOf(text),
    mayHaveApplied: WRITE_CAVEAT.test(text),
  }
}

export interface DescribeErrorOptions {
  fallbackTitle?: string
}

/** Never the raw "[503 ProcessEngineException] …" as the headline; feed the result to the toolkit's `ErrorState`. */
export function describeError(
  error: unknown,
  locale: string | undefined,
  options: DescribeErrorOptions = {},
): DescribedError {
  const labels = ERROR_LABELS[supportedLanguage(locale) ?? "en"]
  const facts = classifyError(error)
  const words: ErrorKindLabels = labels[facts.kind]
  const source = labels.source({ source: facts.source })
  const status = facts.status === undefined ? "" : labels.status({ status: facts.status })
  const title =
    facts.kind === "unknown" && options.fallbackTitle
      ? options.fallbackTitle
      : words.title({ source, status })
  return {
    kind: facts.kind,
    title,
    hint: words.hint({ source: facts.source.type }),
    details: facts.raw,
  }
}
