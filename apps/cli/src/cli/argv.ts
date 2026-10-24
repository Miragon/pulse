/**
 * Raw argument list helpers that run before (or without) commander: global options given before
 * the command path, the addressed group for lazy registration, and the output format and verbosity
 * for errors that happen before the configuration is resolved.
 */

import { OUTPUT_FORMATS, type OutputFormat } from '../config/types.js';
import { GLOBAL_OPTIONS, type GlobalOptionSpec } from './globals.js';

/** End of options: everything after it is a positional argument. */
const END_OF_OPTIONS = '--';

function isOptionToken(token: string): boolean {
  return token.startsWith('-');
}

function byLong(name: string): GlobalOptionSpec | undefined {
  return GLOBAL_OPTIONS.find((spec) => spec.long === name);
}

function byShort(letter: string): GlobalOptionSpec | undefined {
  return GLOBAL_OPTIONS.find((spec) => spec.short === letter);
}

/** Tokens a flag occupies: 1, or 2 with a separate value; 0 when the value is missing. */
function withValue(spec: GlobalOptionSpec | undefined, hasNext: boolean): number {
  if (spec === undefined) return 0;
  if (spec.value === undefined) return 1;
  return hasNext ? 2 : 0;
}

function longOptionLength(token: string, hasNext: boolean): number {
  const [name = '', attached] = token.slice(2).split(/=(.*)/s);
  if (attached === undefined) return withValue(byLong(name), hasNext);
  return byLong(name)?.value === undefined ? 0 : 1;
}

function shortOptionLength(token: string, hasNext: boolean): number {
  const spec = byShort(token.charAt(1));
  if (token.length === 2) return withValue(spec, hasNext);
  // `-ojson`: the value is attached to the letter
  return spec?.value === undefined ? 0 : 1;
}

/** Number of tokens of the global option at `index` (`--url x`, `--url=x`, `-ojson`), or 0. */
export function globalOptionLength(argv: readonly string[], index: number): number {
  const token = argv[index] ?? '';
  const hasNext = index + 1 < argv.length;
  if (token.startsWith('--')) return longOptionLength(token, hasNext);
  return /^-[A-Za-z]/.test(token) ? shortOptionLength(token, hasNext) : 0;
}

/** End index of the command path starting at `start`: a command and, for groups, a subcommand. */
function commandPathEnd(
  argv: readonly string[],
  start: number,
  hasSubcommands: (name: string) => boolean,
): number {
  const first = argv[start];
  if (first === undefined || isOptionToken(first)) return start;
  const second = argv[start + 1];
  const nested = hasSubcommands(first) && second !== undefined && !isOptionToken(second);
  return nested ? start + 2 : start + 1;
}

/**
 * Moves global options given before the command path behind it, so commander finds them on the
 * command that defines them: `-o json task list` → `task list -o json`.
 */
export function normalizeArgv(
  argv: readonly string[],
  hasSubcommands: (name: string) => boolean,
): string[] {
  let index = 0;
  for (let length = globalOptionLength(argv, 0); length > 0;) {
    index += length;
    length = globalOptionLength(argv, index);
  }
  const pathEnd = commandPathEnd(argv, index, hasSubcommands);
  // without leading globals or without a command path this is the list unchanged
  return [...argv.slice(index, pathEnd), ...argv.slice(0, index), ...argv.slice(pathEnd)];
}

/** The group named by a normalized argument list (`task list`, `help task`), if any. */
export function addressedCommand(args: readonly string[]): string | undefined {
  return args[0] === 'help' ? args[1] : args[0];
}

function options(argv: readonly string[]): readonly string[] {
  const end = argv.indexOf(END_OF_OPTIONS);
  return end < 0 ? argv : argv.slice(0, end);
}

/** The flags of an option as typed: `--output`, `-o`. */
interface OptionTokens {
  readonly long: string | undefined;
  readonly short: string | undefined;
}

/** The value of `--<long> v`, `--<long>=v`, `-<short> v` or `-<short>v` at `token`, if any. */
function optionValue(
  { long, short }: OptionTokens,
  token: string,
  next: string | undefined,
): string | undefined {
  if (token === long || token === short) return next;
  if (long !== undefined && token.startsWith(`${long}=`)) return token.slice(long.length + 1);
  return short !== undefined && token.startsWith(short) && token.length > 2
    ? token.slice(2)
    : undefined;
}

/**
 * The last value of a global option with a value (`output`, `config`, ...) in the argument list;
 * `shortOnly` ignores its long form.
 */
export function globalFromArgv(
  argv: readonly string[],
  name: string,
  shortOnly = false,
): string | undefined {
  const spec = byLong(name);
  if (spec?.value === undefined) return undefined;
  const flags: OptionTokens = {
    long: shortOnly ? undefined : `--${spec.long}`,
    short: spec.short === undefined ? undefined : `-${spec.short}`,
  };
  const tokens = options(argv);
  let last: string | undefined;
  tokens.forEach((token, index) => {
    last = optionValue(flags, token, tokens[index + 1]) ?? last;
  });
  return last;
}

/** `config set`, whose `--output` is a profile value: only `-o` chooses its output format. */
function isConfigSet(argv: readonly string[]): boolean {
  // only the first two words of the command path matter here
  const [command, subcommand] = normalizeArgv(argv, () => true);
  return command === 'config' && subcommand === 'set';
}

/** The last `-o/--output` value of the argument list if it is a valid format. */
export function outputFromArgv(argv: readonly string[]): OutputFormat | undefined {
  const last = globalFromArgv(argv, 'output', isConfigSet(argv));
  return OUTPUT_FORMATS.find((format) => format === last);
}

export function verboseRequested(argv: readonly string[]): boolean {
  return options(argv).includes('--verbose');
}
