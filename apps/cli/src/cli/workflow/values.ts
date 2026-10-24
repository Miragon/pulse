/**
 * Reads the option values of the workflow commands (keyed by flag, see `commandValues`) into the
 * typed options of src/workflow. Usage errors name the flag as typed.
 */

import { usageError } from '../../errors.js';
import {
  type CommandValues,
  lastString,
  listValues,
  occurrences,
} from '../../operation/command-values.js';
import { parseDuration } from '../../operation/durations.js';
import { convertScalar } from '../../operation/values.js';
import { parseVariables, type TypedValue } from '../../operation/variables.js';
import { compact } from '../../util.js';
import { globalOptionLength } from '../argv.js';
import { parseCondition } from '../../workflow/conditions.js';
import { shellWord } from '../../workflow/shell.js';
import type { Selection } from '../../workflow/select.js';
import type { WaitSettings } from '../../workflow/wait.js';

type Flags = CommandValues['flags'];

/** Default `--wait-timeout`: Camunda 7 job acquisition backs off up to 60 s on an idle engine. */
const DEFAULT_WAIT_TIMEOUT_MS = 60_000;

export function text(flags: Flags, name: string): string | undefined {
  const value = flags[name];
  return value === undefined ? undefined : lastString(value);
}

export function given(flags: Flags, name: string): boolean {
  return flags[name] !== undefined;
}

/** Every occurrence of a repeatable option, comma lists split. */
export function list(flags: Flags, name: string): string[] {
  const value = flags[name];
  return value === undefined ? [] : listValues(value);
}

/** A value of a fixed set (`--fail-on`, `--incident-type`). */
export function choice<T extends string>(
  flags: Flags,
  name: string,
  values: readonly T[],
): T | undefined {
  const raw = text(flags, name);
  if (raw === undefined) return undefined;
  return convertScalar({ type: 'string', enum: values }, raw, `--${name}`) as T;
}

/** A whole number option within a range. */
export function integer(
  flags: Flags,
  name: string,
  range: { readonly min: number; readonly max: number },
): number | undefined {
  const raw = text(flags, name);
  if (raw === undefined) return undefined;
  const value = Number(convertScalar({ type: 'integer', format: 'int32' }, raw, `--${name}`));
  if (value < range.min || value > range.max) {
    throw usageError(
      `--${name} expects an integer between ${range.min} and ${range.max}, got "${raw}"`,
    );
  }
  return value;
}

/** `--var` style variables; undefined when the option was not given. */
export function variables(flags: Flags, name: string): Record<string, TypedValue> | undefined {
  const value = flags[name];
  return value === undefined ? undefined : parseVariables(occurrences(value), name);
}

/** Selection options with a value; `--latest` has none. */
const SELECTION_VALUES: ReadonlySet<string> = new Set([
  '--business-key',
  '--process-definition-key',
]);

/** Index of the command name: after the global options given before it. */
function commandIndex(argv: readonly string[]): number {
  let index = 0;
  for (let length = globalOptionLength(argv, 0); length > 0;) {
    index += length;
    length = globalOptionLength(argv, index);
  }
  return index;
}

/**
 * The words of the command line other than the command name, the process instance id and the
 * selection options, shell quoted: ready commands (an ambiguous selection, several places to
 * advance) put the id or the activity in and keep everything else (`--var`, `--wait`, ...).
 */
export function otherWords(argv: readonly string[], id?: string): string[] {
  const command = commandIndex(argv);
  const words: string[] = [];
  let positional = id;
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    const flag = token.split('=')[0] ?? '';
    if (SELECTION_VALUES.has(flag)) {
      if (!token.includes('=')) index++;
    } else if (index > command && token === positional) {
      positional = undefined;
    } else if (index !== command && token !== '--latest') {
      words.push(shellWord(token));
    }
  }
  return words;
}

export function selectionOf(values: CommandValues, argv: readonly string[] = []): Selection {
  const options = otherWords(argv, values.args[0]);
  return {
    ...compact({
      id: values.args[0],
      businessKey: text(values.flags, 'business-key'),
      processDefinitionKey: text(values.flags, 'process-definition-key'),
    }),
    latest: values.flags.latest === true,
    ...(options.length > 0 ? { options } : {}),
  };
}

/** The wait settings of `wait` (and of `--wait` / `--until`); default condition `idle`. */
export function waitSettings(flags: Flags): WaitSettings {
  const until = (flags.until === undefined ? [] : occurrences(flags.until)).map(parseCondition);
  const timeout = text(flags, 'wait-timeout');
  return {
    conditions: until.length > 0 ? until : [{ kind: 'idle' }],
    timeoutMs:
      timeout === undefined ? DEFAULT_WAIT_TIMEOUT_MS : parseDuration(timeout, '--wait-timeout'),
    failOnIncident: flags['fail-on-incident'] !== false,
    executeJobs: flags['execute-jobs'] === true,
  };
}

/**
 * The wait settings of advance, retry and deploy: only with `--wait` or `--until`; the other wait
 * options without them are usage errors.
 */
export function optionalWaitSettings(flags: Flags): WaitSettings | undefined {
  if (flags.wait === true || given(flags, 'until')) return waitSettings(flags);
  for (const [name, flag] of [
    ['wait-timeout', '--wait-timeout'],
    ['fail-on-incident', '--no-fail-on-incident'],
  ] as const) {
    if (given(flags, name)) {
      throw usageError(`${flag} needs --wait or --until`, 'Example: --wait --wait-timeout 2m');
    }
  }
  return undefined;
}
