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

/** A text as written and each encoding a server may quote it in. */
const ENCODINGS: readonly ((text: string) => string)[] = [
  (text) => text,
  encodeURIComponent,
  (text) => JSON.stringify(text).slice(1, -1),
  pathForm,
  formForm,
]

/**
 * `text` as written and in each encoding a server may quote it in. An encoding that cannot write
 * it gives no form, and the others still mask it: percent-encoding refuses a lone surrogate with
 * a URIError, which would fail every request that carries the secret.
 */
function encodingsOf(text: string): readonly string[] {
  return ENCODINGS.flatMap((encode) => {
    try {
      return [encode(text)]
    } catch {
      return []
    }
  })
}

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

/** A form as the source of a pattern: its runs of whitespace match any run of whitespace. */
function sourceOf(form: string): string {
  return form
    .split(/\s+/)
    .map((part) => part.replace(SPECIAL, "\\$&"))
    .join("\\s+")
}

/** Every occurrence of each pattern in turn replaced by {@link MASK}. */
function replaced(text: string, patterns: readonly RegExp[]): string {
  let masked = text
  for (const pattern of patterns) masked = masked.replace(pattern, MASK)
  return masked
}

/** A form as a pattern, global for `replace`. */
const patternOf = (form: string): RegExp => new RegExp(sourceOf(form), "g")

/** `text` with every occurrence of a form replaced by {@link MASK}; its whitespace stays. */
export function maskSecrets(text: string, forms: readonly string[]): string {
  return replaced(text, forms.map(patternOf))
}

/**
 * The forms of one JSON text, each compiled once for all its literals and numbers (#691): each
 * form's pattern in turn, which masks, and all of them in one, which finds where the next starts
 * (global, so `exec` searches from its `lastIndex`) and whether a text holds one (no flag, so
 * `test` keeps no state).
 */
interface Patterns {
  readonly each: readonly RegExp[]
  readonly next: RegExp
  readonly any: RegExp
}

function patternsOf(forms: readonly string[]): Patterns {
  const any = forms.map(sourceOf).join("|")
  return { each: forms.map(patternOf), next: new RegExp(any, "g"), any: new RegExp(any) }
}

/**
 * `text` masked form by form, or undefined when no form occurs in it, which masking leaves alone:
 * one search for all forms first, since most texts looked at (a literal with an escape) hold none.
 */
function maskedText(text: string, patterns: Patterns): string | undefined {
  return patterns.any.test(text) ? replaced(text, patterns.each) : undefined
}

/** Where the first occurrence of `pattern` at or after `from` starts, or the text's length. */
function nextAt(pattern: RegExp, text: string, from: number): number {
  pattern.lastIndex = from
  return pattern.exec(text)?.index ?? text.length
}

/** The index of the quote closing a string literal whose first backslash is at `slash`, or -1. */
function closingQuote(text: string, slash: number): number {
  let at = slash
  for (let char = text[at]; char !== undefined; char = text[at]) {
    if (char === '"') return at
    at += char === "\\" ? 2 : 1
  }
  return -1
}

/**
 * One JSON string literal, masked as the text it stands for and written back as a literal, or
 * undefined when it stays as it came.
 */
function maskedLiteral(literal: string, patterns: Patterns): string | undefined {
  let value: string
  try {
    // A quoted literal parses to a string, or not at all (an escape JSON does not know).
    value = JSON.parse(literal) as string
  } catch {
    return maskedText(literal, patterns)
  }
  const masked = maskedText(value, patterns) ?? value
  return masked === value ? undefined : JSON.stringify(masked)
}

/** A JSON number. */
const NUMBER = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g

/** Text between string literals with each number that carries a secret written as `"***"`. */
function maskedNumbers(text: string, any: RegExp): string {
  return text.replace(NUMBER, (number) => (any.test(number) ? JSON.stringify(MASK) : number))
}

/**
 * One pass over a JSON text, in time linear in its length: a piece (a literal, or the text between
 * two) is masked only where a form starts in it or, for a literal, a backslash stands in it, and
 * every other piece stays as it is, since masking leaves it alone. Where the next form starts is
 * searched at most once per piece, from the piece on, never once per occurrence: a form that
 * overlaps itself (`0000` in a run of zeros) starts at every character of the run.
 */
class JsonPass {
  /** The masked text up to `copied`; the text from there on is still the input's. */
  private written = ""
  private copied = 0
  /** Where the next form starts, at or after the piece at hand; the text's length when none. */
  private secret = -1

  constructor(
    private readonly text: string,
    private readonly patterns: Patterns,
  ) {}

  /** The text from `from` to `to`, between literals: its numbers masked if a form starts in it. */
  numbers(from: number, to: number): void {
    if (this.seek(from) < to) {
      this.write(from, to, maskedNumbers(this.text.slice(from, to), this.patterns.any))
    }
  }

  /**
   * The literal from `start` to its closing quote: masked if escaped or a form starts in it, and
   * written only if that changed it, so a literal looked at for its escape alone costs no copy.
   */
  literal(start: number, end: number, escaped: boolean): void {
    if (escaped || this.seek(start) < end) {
      const masked = maskedLiteral(this.text.slice(start, end + 1), this.patterns)
      if (masked !== undefined) this.write(start, end + 1, masked)
    }
  }

  /** The text masked so far and the rest as it is, all of it masked as plain text once more. */
  finished(): string {
    return replaced(this.written + this.text.slice(this.copied), this.patterns.each)
  }

  /**
   * Where the first form at or after `from` starts. `from` never goes back, so a start once found
   * holds until `from` passes it, and no stretch of the text is searched twice.
   */
  private seek(from: number): number {
    if (this.secret < from) this.secret = nextAt(this.patterns.next, this.text, from)
    return this.secret
  }

  private write(from: number, to: number, masked: string): void {
    this.written += this.text.slice(this.copied, from) + masked
    this.copied = to
  }
}

/**
 * A JSON text masked inside its string literals, so it stays JSON and a secret written with
 * escapes is found as well; a number that carries a secret (an error code that holds a password
 * of digits) becomes the string `"***"`, so the text stays JSON then too. A secret still left
 * outside them (in `true`, across a comma) masks the whole text: then it may no longer parse, but
 * it shows no secret. Each form compiles once, and only a literal or a number a form starts in, or
 * a literal with an escape, is looked at, so an answer of millions of literals masks in one pass.
 */
export function maskJsonText(text: string, forms: readonly string[]): string {
  if (forms.length === 0) return text
  const pass = new JsonPass(text, patternsOf(forms))
  let at = 0
  for (let start = text.indexOf('"'); start !== -1; start = text.indexOf('"', at)) {
    // Up to its first backslash, the next quote closes a literal.
    const quote = text.indexOf('"', start + 1)
    const slash = text.slice(start + 1, quote).indexOf("\\")
    const end = slash === -1 ? quote : closingQuote(text, start + 1 + slash)
    // An unterminated literal: no JSON, so its rest stays as it is for the last pass to mask.
    if (end === -1) return pass.finished()
    pass.numbers(at, start)
    pass.literal(start, end, slash !== -1)
    at = end + 1
  }
  pass.numbers(at, text.length)
  return pass.finished()
}

/** Text for one line of a message: whitespace collapsed, cut after `max` characters. */
export function clipText(text: string, max = 500): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}
