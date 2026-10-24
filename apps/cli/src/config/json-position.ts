/**
 * Where JSON text stops being valid, as line and column. V8's JSON.parse messages quote the text
 * around the error, which for the config file may be a stored credential; this scanner gives the
 * position without repeating any content. Pure.
 */

interface Scanner {
  readonly text: string;
  position: number;
}

const WHITESPACE = /[\t\n\r ]*/y;
// JSON strings must not contain raw C0 control characters (DEL and C1 are allowed)
// eslint-disable-next-line no-control-regex
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/y;
const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const LITERAL = /true|false|null/y;

/** Consumes `pattern` at the current position; false (position unchanged) when it does not match. */
function consume(scanner: Scanner, pattern: RegExp): boolean {
  pattern.lastIndex = scanner.position;
  const match = pattern.exec(scanner.text);
  if (match === null) return false;
  scanner.position += match[0].length;
  return true;
}

function skipWhitespace(scanner: Scanner): void {
  consume(scanner, WHITESPACE);
}

function consumeChar(scanner: Scanner, char: string): boolean {
  skipWhitespace(scanner);
  if (scanner.text.charAt(scanner.position) !== char) return false;
  scanner.position += 1;
  return true;
}

/** `open`, then items separated by commas (none allowed), then `close`. */
function sequence(scanner: Scanner, close: string, item: (scanner: Scanner) => boolean): boolean {
  if (consumeChar(scanner, close)) return true;
  do {
    if (!item(scanner)) return false;
  } while (consumeChar(scanner, ','));
  return consumeChar(scanner, close);
}

function member(scanner: Scanner): boolean {
  skipWhitespace(scanner);
  return consume(scanner, STRING) && consumeChar(scanner, ':') && value(scanner);
}

function value(scanner: Scanner): boolean {
  skipWhitespace(scanner);
  if (consumeChar(scanner, '{')) return sequence(scanner, '}', member);
  if (consumeChar(scanner, '[')) return sequence(scanner, ']', value);
  return consume(scanner, STRING) || consume(scanner, NUMBER) || consume(scanner, LITERAL);
}

/** 1-based line and column of an offset. */
function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length, column: (lines.at(-1) ?? '').length + 1 };
}

/**
 * The position of the first syntax error of `text` (1-based line and column), or undefined when
 * the text is valid JSON (or nested too deeply to scan).
 */
export function jsonErrorPosition(text: string): { line: number; column: number } | undefined {
  const scanner: Scanner = { text, position: 0 };
  let valid: boolean;
  try {
    valid = value(scanner);
  } catch {
    // nesting deeper than the call stack: no position, the caller still reports invalid JSON
    return undefined;
  }
  skipWhitespace(scanner);
  return valid && scanner.position === text.length
    ? undefined
    : lineAndColumn(text, scanner.position);
}
