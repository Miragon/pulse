/**
 * What JSON.parse does not tell: where invalid text stops being JSON, and the keys of an object
 * as the text lists them. JSON.parse keeps only the last of two equal keys and moves keys of
 * digits to the front, so a second `profiles` block, a repeated profile name or a second
 * `"readOnly": false` would win silently and a file's order would change. Messages never quote
 * the text: V8's own messages do, and the text may hold a credential.
 */

const WHITESPACE = /[\t\n\r ]*/y
/** The characters of a string up to its next quote or escape. */
const PLAIN = /[^"\\]*/y
const ESCAPE = /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})/y
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const LITERAL = /true|false|null/y
/** JSON strings must not contain raw C0 control characters (DEL and C1 are allowed). */
const FIRST_PRINTABLE = 0x20

interface Scanner {
  readonly text: string
  position: number
}

/** Consumes `pattern` at the current position; false (position unchanged) when it does not match. */
function consume(scanner: Scanner, pattern: RegExp): boolean {
  pattern.lastIndex = scanner.position
  const match = pattern.exec(scanner.text)
  if (match === null) return false
  scanner.position += match[0].length
  return true
}

function hasControl(text: string, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (text.charCodeAt(index) < FIRST_PRINTABLE) return true
  }
  return false
}

/** Consumes a string literal; false (position unchanged) when none starts here. */
function consumeString(scanner: Scanner): boolean {
  const { text } = scanner
  if (text.charAt(scanner.position) !== '"') return false
  let index = scanner.position + 1
  for (;;) {
    PLAIN.lastIndex = index
    PLAIN.exec(text)
    if (hasControl(text, index, PLAIN.lastIndex)) return false
    index = PLAIN.lastIndex
    if (text.charAt(index) === '"') break
    ESCAPE.lastIndex = index
    if (ESCAPE.exec(text) === null) return false
    index = ESCAPE.lastIndex
  }
  scanner.position = index + 1
  return true
}

function skipWhitespace(scanner: Scanner): void {
  consume(scanner, WHITESPACE)
}

function consumeChar(scanner: Scanner, char: string): boolean {
  skipWhitespace(scanner)
  if (scanner.text.charAt(scanner.position) !== char) return false
  scanner.position += 1
  return true
}

/** `open`, then items separated by commas (none allowed), then `close`. */
function sequence(scanner: Scanner, close: string, item: (scanner: Scanner) => boolean): boolean {
  if (consumeChar(scanner, close)) return true
  do {
    if (!item(scanner)) return false
  } while (consumeChar(scanner, ","))
  return consumeChar(scanner, close)
}

function member(scanner: Scanner): boolean {
  skipWhitespace(scanner)
  return consumeString(scanner) && consumeChar(scanner, ":") && value(scanner)
}

function value(scanner: Scanner): boolean {
  skipWhitespace(scanner)
  if (consumeChar(scanner, "{")) return sequence(scanner, "}", member)
  if (consumeChar(scanner, "[")) return sequence(scanner, "]", value)
  return consumeString(scanner) || consume(scanner, NUMBER) || consume(scanner, LITERAL)
}

/** 1-based line and column of an offset. */
function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const lines = text.slice(0, offset).split("\n")
  return { line: lines.length, column: (lines.at(-1) ?? "").length + 1 }
}

/**
 * The position of the first syntax error of `text` (1-based line and column), or undefined when
 * the text is valid JSON (or nested too deeply to scan).
 */
export function jsonErrorPosition(text: string): { line: number; column: number } | undefined {
  const scanner: Scanner = { text, position: 0 }
  let valid: boolean
  try {
    valid = value(scanner)
  } catch {
    // nesting deeper than the call stack: no position, the caller still reports invalid JSON
    return undefined
  }
  skipWhitespace(scanner)
  return valid && scanner.position === text.length
    ? undefined
    : lineAndColumn(text, scanner.position)
}

/** One member of an object as its text lists it: the key, and where its value starts and ends. */
export interface Member {
  readonly key: string
  readonly start: number
  readonly end: number
}

/** The members of an object, keys first-come, and the keys the text repeats. */
export interface Members {
  /**
   * Each key once, in the order of its first occurrence in the text, with where its LAST value
   * stands: the one JSON.parse keeps, so a caller that reads into it reads the value it got.
   */
  readonly first: readonly Member[]
  /** Each key the text lists more than once, in the order of its second occurrence. */
  readonly repeated: readonly string[]
}

/** The index after the string literal that opens at `open`. */
function stringEnd(text: string, open: number): number {
  let index = open + 1
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1
  return index + 1
}

function skip(text: string, from: number): number {
  WHITESPACE.lastIndex = from
  WHITESPACE.exec(text)
  return WHITESPACE.lastIndex
}

/** The index after the object or array that opens at `open`; strings may hold brackets. */
function containerEnd(text: string, open: number): number {
  let depth = 0
  let index = open
  do {
    const char = text[index]
    if (char === '"') {
      index = stringEnd(text, index)
      continue
    }
    if (char === "{" || char === "[") depth += 1
    else if (char === "}" || char === "]") depth -= 1
    index += 1
  } while (depth > 0 && index < text.length)
  return index
}

/** The index after the value that starts at `start`. */
function valueEnd(text: string, start: number): number {
  const char = text[start]
  if (char === '"') return stringEnd(text, start)
  if (char === "{" || char === "[") return containerEnd(text, start)
  const scalar = /[^,\]}\s]*/y
  scalar.lastIndex = start
  scalar.exec(text)
  return scalar.lastIndex
}

/** Where the root value of `text` starts. */
export function rootStart(text: string): number {
  return skip(text, 0)
}

/**
 * The members of the object whose `{` is at `open`, read from text that JSON.parse accepted; none
 * when no object opens there. Values are not read here, only skipped: the caller takes them from
 * JSON.parse, which keeps the last value of a key the text repeats, so each member points at that
 * last value (a first value of another kind, a string or a list, is never scanned as an object).
 */
export function objectMembers(text: string, open: number): Members {
  const seen = new Map<string, Member>()
  const repeated: string[] = []
  if (text[open] !== "{") return { first: [], repeated }
  let index = skip(text, open + 1)
  while (text[index] === '"') {
    const keyEnd = stringEnd(text, index)
    const key = JSON.parse(text.slice(index, keyEnd)) as string
    const start = skip(text, skip(text, keyEnd) + 1)
    const end = valueEnd(text, start)
    if (seen.has(key) && !repeated.includes(key)) repeated.push(key)
    // A Map keeps the place of the first set: the order stays the text's, the value the last one.
    seen.set(key, { key, start, end })
    index = skip(text, end)
    if (text[index] === ",") index = skip(text, index + 1)
  }
  return { first: [...seen.values()], repeated }
}
