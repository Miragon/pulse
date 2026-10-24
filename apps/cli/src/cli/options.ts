/**
 * Registers the operation options described by `operationOptions()` (src/docs/options.ts) as
 * commander options and maps the parsed values back to catalog flags (`CommandValues`).
 */

import { type Command, Option } from 'commander';
import type { OptionDoc } from '../docs/options.js';
import type { CommandValues, FlagValue } from '../operation/input.js';
import { setOptionCompletion } from './completion-meta.js';
import { setHelpTerm } from './help.js';

/** A registered operation option: commander attribute name → catalog flag. */
export interface RegisteredOption {
  readonly attribute: string;
  readonly flag: string;
}

/** commander argument parser of repeatable options: collects every occurrence in order. */
export function collect(value: string, previous: unknown): string[] {
  return [...(Array.isArray(previous) ? (previous as string[]) : []), value];
}

/** Help text of an option: description, allowed values and whether it is required. */
export function optionDescription(doc: OptionDoc): string {
  const choices = doc.enum === undefined ? '' : ` (choices: ${doc.enum.join(', ')})`;
  const required = doc.required ? ' (required)' : '';
  return `${doc.description}${choices}${required}`.trim();
}

/**
 * A plain flag meaning true. commander treats `--no-x` as the negation of `--x`; for catalog flags
 * that start with `no-` (`--no-retries-left`) that is switched off, so the flag is stored as
 * `noRetriesLeft: true`.
 */
function presenceOption(flag: string, description: string): Option {
  const option = new Option(`--${flag}`, description);
  option.negate = false;
  return option;
}

function valueOption(doc: OptionDoc, description: string): Option {
  return new Option(`--${doc.flag} ${doc.valueName ?? '<value>'}`, description);
}

/** An option doc with the completion facts of the workflow options. */
type CompletableDoc = OptionDoc & {
  readonly complete?: 'files' | 'dirs';
  readonly suggest?: readonly string[];
};

/** Path values complete to files or directories (`--body @file`, `--base-dir`, file parts). */
function pathOf(doc: CompletableDoc) {
  if (doc.complete !== undefined) return doc.complete;
  if (doc.source === 'base-dir') return 'dirs';
  return doc.source === 'file' || doc.source === 'body' ? 'files' : undefined;
}

/** The commander options of one option doc; the first one carries the help text. */
export function createOptions(doc: CompletableDoc): Option[] {
  const options = optionsOf(doc);
  const path = pathOf(doc);
  const values = doc.enum ?? doc.suggest;
  const [main] = options;
  if (main !== undefined && (values !== undefined || path !== undefined)) {
    setOptionCompletion(main, {
      ...(values === undefined ? {} : { values }),
      ...(path === undefined ? {} : { path }),
    });
  }
  return options;
}

function optionsOf(doc: OptionDoc): Option[] {
  const description = optionDescription(doc);
  switch (doc.kind) {
    case 'value':
      return [valueOption(doc, description)];
    case 'repeatable':
      return [valueOption(doc, description).argParser(collect)];
    case 'presence':
      return [presenceOption(doc.flag, description)];
    case 'negated':
      return [new Option(`--no-${doc.flag}`, description)];
    case 'boolean':
      // no default: absent means "not given", so the engine default applies
      return [new Option(`--${doc.flag}`, description), new Option(`--no-${doc.flag}`).hideHelp()];
  }
}

/** Adds the options to the command; the help shows each with its syntax, e.g. `--[no-]x`. */
export function addOperationOptions(
  command: Command,
  docs: readonly OptionDoc[],
): RegisteredOption[] {
  return docs.map((doc) => {
    const [main, ...twins] = createOptions(doc) as [Option, ...Option[]];
    setHelpTerm(main, doc.syntax);
    for (const option of [main, ...twins]) command.addOption(option);
    return { attribute: main.attributeName(), flag: doc.flag };
  });
}

function isFlagValue(value: unknown): value is FlagValue {
  return typeof value === 'string' || typeof value === 'boolean' || Array.isArray(value);
}

/**
 * Positional arguments and the operation options given on the command line, keyed by catalog
 * flag. Values commander set itself (defaults) are left out: absent means "not given".
 */
export function commandValues(
  command: Command,
  registered: readonly RegisteredOption[],
): CommandValues {
  const opts = command.opts<Record<string, unknown>>();
  const flags: Record<string, FlagValue> = {};
  for (const { attribute, flag } of registered) {
    const value = opts[attribute];
    if (command.getOptionValueSource(attribute) === 'cli' && isFlagValue(value)) {
      flags[flag] = value;
    }
  }
  return { args: [...command.args], flags };
}
