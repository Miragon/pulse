/** Shape of a utility command (everything that is not a catalog group). */

import type { Command } from 'commander';
import type { CliContext } from '../context.js';

export interface UtilityCommand {
  readonly name: string;
  /** True when the command has subcommands (`config set`); used to locate the command path. */
  readonly nested: boolean;
  register(program: Command, context: CliContext): void;
}
