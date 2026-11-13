/**
 * Secrets out of every text a failure or a trace shows. An engine, a proxy or a gateway may quote
 * a request's credentials back (a stack trace with the Authorization header, a login page with
 * the token in its URL), so every text that came from the server is masked with the secrets of
 * the request that drew it. The rule is the MCP server's since 0.27: every value trimmed, with
 * any run of whitespace in it matching any run in the text (so a reflowed message cannot hide
 * it), as written, percent-encoded, JSON-escaped, as a URL path writes it (a redirect target
 * after parsing) and form-encoded (`+` for a space), longest first; values under four characters
 * are left alone, since masking them would shred ordinary text.
 */

/** What stands in for a secret. */
export const MASK = "***"

const MIN_SECRET_LENGTH = 4
const SPECIAL = /[.*+?^${}()|[\]\\]/g

/** `core` as the URL parser writes it into a path (`%20` for a space, `@` and `!` kept). */
function pathForm(core: string): string {
  const url = new URL("http://h/")
  url.pathname = core
  return url.pathname.slice(1)
}

/** `core` as a form writes it (application/x-www-form-urlencoded: `+` for a space). */
const formForm = (core: string): string => new URLSearchParams([["", core]]).toString().slice(1)

/** `text` as written and in each encoding a server may quote it in. */
const encodingsOf = (text: string): readonly string[] => [
  text,
  encodeURIComponent(text),
  JSON.stringify(text).slice(1, -1),
  pathForm(text),
  formForm(text),
]

/**
 * The forms of `values` a text may carry, longest first, so a value is masked whole before any
 * shorter one inside it. Each value is encoded with its whitespace collapsed and as it is (an
 * encoding writes each space of a run), and a form the parser shortened below four characters
 * (a value of dot segments) is left out.
 */
export function secretForms(values: readonly (string | undefined)[]): readonly string[] {
  const forms = new Set<string>()
  for (const value of values) {
    const trimmed = value?.trim() ?? ""
    if (trimmed.length < MIN_SECRET_LENGTH) continue
    const core = trimmed.replace(/\s+/g, " ")
    for (const form of [...encodingsOf(core), ...encodingsOf(trimmed)]) {
      if (form.length >= MIN_SECRET_LENGTH) forms.add(form)
    }
  }
  return [...forms].sort((a, b) => b.length - a.length)
}

/** A form as a pattern: its runs of whitespace match any run of whitespace. */
function patternOf(form: string): RegExp {
  const parts = form.split(/\s+/).map((part) => part.replace(SPECIAL, "\\$&"))
  return new RegExp(parts.join("\\s+"), "g")
}

/** `text` with every occurrence of a form replaced by {@link MASK}; its whitespace stays. */
export function maskSecrets(text: string, forms: readonly string[]): string {
  let masked = text
  for (const form of forms) masked = masked.replace(patternOf(form), MASK)
  return masked
}

/** The index of the quote that closes the string literal opened at `start`, or -1. */
function literalEnd(text: string, start: number): number {
  for (let at = start + 1; at < text.length; at += 1) {
    const char = text[at]
    if (char === "\\") at += 1
    else if (char === '"') return at
  }
  return -1
}

/** One JSON string literal, masked as the text it stands for and written back as a literal. */
function maskedLiteral(literal: string, forms: readonly string[]): string {
  let value: string
  try {
    // A quoted literal parses to a string, or not at all (an escape JSON does not know).
    value = JSON.parse(literal) as string
  } catch {
    return maskSecrets(literal, forms)
  }
  const masked = maskSecrets(value, forms)
  return masked === value ? literal : JSON.stringify(masked)
}

/** A JSON number. */
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

/** Text between string literals with each number that carries a secret written as `"***"`. */
function maskedNumbers(text: string, forms: readonly string[]): string {
  return text.replace(NUMBER, (number) =>
    forms.some((form) => patternOf(form).test(number)) ? JSON.stringify(MASK) : number,
  )
}

/** `masked`, or all of it masked as plain text when a secret is still in it. */
function finished(masked: string, forms: readonly string[]): string {
  return forms.some((form) => patternOf(form).test(masked)) ? maskSecrets(masked, forms) : masked
}

/**
 * A JSON text masked inside its string literals, so it stays JSON and a secret written with
 * escapes is found as well; a number that carries a secret (an error code that holds a password
 * of digits) becomes the string `"***"`, so the text stays JSON then too. A secret still left
 * outside them (in `true`, across a comma) masks the whole text: then it may no longer parse, but
 * it shows no secret.
 */
export function maskJsonText(text: string, forms: readonly string[]): string {
  if (forms.length === 0) return text
  let masked = ""
  let at = 0
  for (let start = text.indexOf('"'); start !== -1; start = text.indexOf('"', at)) {
    const end = literalEnd(text, start)
    // An unterminated literal: no JSON, so its rest stays as it is for `finished` to mask.
    if (end === -1) return finished(masked + text.slice(at), forms)
    const literal = maskedLiteral(text.slice(start, end + 1), forms)
    masked += maskedNumbers(text.slice(at, start), forms) + literal
    at = end + 1
  }
  return finished(masked + maskedNumbers(text.slice(at), forms), forms)
}

/** Text for one line of a message: whitespace collapsed, cut after `max` characters. */
export function clipText(text: string, max = 500): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
