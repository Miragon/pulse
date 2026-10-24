/**
 * The commander program. Registration is lazy (design §9.2): every group is registered with its
 * description, but operation commands only for the group addressed on the command line.
 */

import { Command } from 'commander';
import { findGroup, operationsInGroup } from '../catalog/catalog.js';
import type { Catalog } from '../catalog/types.js';
import { listGroups } from '../docs/commands.js';
import { VERSION } from '../version.js';
import { addressedCommand } from './argv.js';
import { subcommand } from './command.js';
import { UTILITY_COMMANDS } from './commands/index.js';
import type { CliContext } from './context.js';
import { exitHandler } from './errors.js';
import { helpConfiguration, outputConfiguration, ROOT_DESCRIPTION, rootFooter } from './help.js';
import { registerOperation } from './operation.js';
import { registerWorkflowCommands } from './workflow/index.js';

const GROUP_FOOTER = `
Run "operate <group> <command> --help" for the arguments and options of a command, or
"operate describe <group> <command>" for the request body schema and the responses.`;

const GROUPS_HEADING = 'API groups:';

/**
 * True for commands followed by a subcommand: catalog groups, nested utility commands (`config`)
 * and `help <command>`, so `-o json help task` shows the help of `task`.
 */
export function hasSubcommands(catalog: Catalog, name: string): boolean {
  return (
    name === 'help' ||
    findGroup(catalog, name) !== undefined ||
    UTILITY_COMMANDS.some((utility) => utility.name === name && utility.nested)
  );
}

/** Every group in alphabetical order; operation commands only for the addressed one. */
function registerGroups(program: Command, context: CliContext, addressed: string | undefined) {
  for (const { group, description } of listGroups(context.catalog)) {
    const command = subcommand(program, group).description(description).helpGroup(GROUPS_HEADING);
    if (group !== addressed) continue;
    command.addHelpText('after', GROUP_FOOTER);
    for (const operation of operationsInGroup(context.catalog, group)) {
      registerOperation(command, operation, context);
    }
  }
}

/** Builds the program for the (normalized) argument list. */
export function createProgram(args: readonly string[], context: CliContext): Command {
  const program = new Command('operate');
  program
    .exitOverride(exitHandler(program))
    .configureOutput(outputConfiguration(context.runtime))
    .configureHelp(helpConfiguration())
    // root options (-V, -h) only before the command path, so that operation flags such as
    // `--version` (a filter of `process-definition list`) reach the operation; normalizeArgv moves
    // global options given before the path behind it. Suggestions are computed by errors.ts.
    .enablePositionalOptions()
    .showSuggestionAfterError(false)
    .version(VERSION, '-V, --version', 'Print the version')
    .helpOption('-h, --help', 'Display help for command')
    .helpCommand('help [command]', 'Display help for a command')
    .description(ROOT_DESCRIPTION)
    .addHelpText('after', rootFooter());
  // utilities first: the root help lists "Commands:", "Workflow commands:", then "API groups:"
  for (const utility of UTILITY_COMMANDS) utility.register(program, context);
  registerWorkflowCommands(program, context);
  registerGroups(program, context, addressedCommand(args));
  return program;
}
