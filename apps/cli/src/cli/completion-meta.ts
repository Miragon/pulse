/**
 * Completion facts attached to commander options and commands (like the help terms of help.ts):
 * enum values, path kinds and what positional arguments complete to. The completion model reads
 * them back (src/cli/completion-model.ts), so completion follows the registered commands.
 */

import type { Command, Option } from 'commander';
import type { PathKind, Positional } from '../docs/completion.js';

export interface OptionCompletion {
  readonly values?: readonly string[];
  readonly path?: PathKind;
  readonly profiles?: boolean;
}

const OPTIONS = new WeakMap<Option, OptionCompletion>();
const POSITIONALS = new WeakMap<Command, Positional>();

export function setOptionCompletion(option: Option, completion: OptionCompletion): Option {
  OPTIONS.set(option, completion);
  return option;
}

export function optionCompletion(option: Option): OptionCompletion | undefined {
  return OPTIONS.get(option);
}

export function setPositional(command: Command, positional: Positional): Command {
  POSITIONALS.set(command, positional);
  return command;
}

export function positionalOf(command: Command): Positional | undefined {
  return POSITIONALS.get(command);
}
