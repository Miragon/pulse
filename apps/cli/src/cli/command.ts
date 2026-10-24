/** Creates subcommands with the settings every command of the CLI needs. */

import type { Command } from 'commander';
import { exitHandler } from './errors.js';

/**
 * Adds a subcommand. It inherits output, help and parsing settings from `parent`, and gets its own
 * exit handler so that errors name the command they belong to.
 */
export function subcommand(parent: Command, name: string): Command {
  const command = parent.command(name);
  return command.exitOverride(exitHandler(command));
}
