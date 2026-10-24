/**
 * `operate commands [group] [--search <text>] [--effect <effect>]` (design §5): the groups of the
 * catalog, or the commands of a group, a search or an effect. JSON when stdout is not a terminal,
 * else a table (GROUP COMMANDS DESCRIPTION / COMMAND EFFECT SUMMARY).
 */

import { type Command, Option } from 'commander';
import { findGroup } from '../../catalog/catalog.js';
import { type Catalog, EFFECTS, type Effect } from '../../catalog/types.js';
import {
  type CommandRow,
  discoveryGroups,
  findCommands,
  type GroupSummary,
} from '../../docs/commands.js';
import { WORKFLOW_GROUP } from '../../docs/workflow.js';
import { usageError } from '../../errors.js';
import { renderTable } from '../../output/table.js';
import { compact } from '../../util.js';
import { subcommand } from '../command.js';
import { setPositional } from '../completion-meta.js';
import { operationSummary } from '../operation.js';
import type { CliContext } from '../context.js';
import { type Display, displayOf, displayText } from '../display.js';
import { addGlobalOptions, readGlobals } from '../globals.js';
import { didYouMean, groupSuggestions } from './suggest.js';
import type { UtilityCommand } from './types.js';

/**
 * Global options of the docs commands (`commands`, `describe`), listed under "Options:" next to
 * the `-h, --help` they inherit from the program.
 */
export const DOCS_OPTIONS: readonly string[] = ['output', 'fields', 'pretty'];
export const OPTIONS_GROUP = 'Options:';

/** Table columns; names are never truncated (the description or summary is). */
const GROUP_TABLE = { columns: ['GROUP', 'COMMANDS', 'DESCRIPTION'], fixed: ['GROUP'] };
const COMMAND_TABLE = { columns: ['COMMAND', 'EFFECT', 'SUMMARY'], fixed: ['COMMAND'] };

const DESCRIPTION = [
  'List the API groups, or the commands of a group, a search or an effect.',
  '',
  'Without arguments: every group with its number of commands, and the group "workflow" of the top-level workflow commands. With a group, --search or --effect: the matching commands with method, path, effect and summary (workflow commands first, with the operations they call). --search is case-insensitive; each of its words must occur in the command, its aliases, the operationId, the summary or the path (for workflow commands: name, summary or description).',
].join('\n');

interface CommandsOptions {
  readonly search?: string;
  readonly effect?: Effect;
}

/** JSON (or a table of the `--fields`), else the given table rows and columns. */
function render(
  value: unknown,
  rows: unknown[],
  table: { columns: string[]; fixed: string[] },
  display: Display,
): string {
  return displayText(
    value,
    display,
    () => `${renderTable(rows, { ...table, maxWidth: display.maxWidth })}\n`,
  );
}

export function groupsText(groups: readonly GroupSummary[], display: Display): string {
  const rows = groups.map((group) => ({
    GROUP: group.group,
    COMMANDS: group.commands,
    DESCRIPTION: group.description,
  }));
  return render(groups, rows, GROUP_TABLE, display);
}

export function commandsText(commands: readonly CommandRow[], display: Display): string {
  const rows = commands.map((summary) => ({
    COMMAND: summary.command,
    EFFECT: summary.effect,
    SUMMARY: 'operationId' in summary ? operationSummary(summary) : summary.summary,
  }));
  return render(commands, rows, COMMAND_TABLE, display);
}

/** Throws a USAGE error for a name that is not a group of the catalog (or `workflow`). */
export function requireGroup(catalog: Catalog, name: string): void {
  if (findGroup(catalog, name) !== undefined || name === WORKFLOW_GROUP.group) return;
  const suggestions = didYouMean(groupSuggestions(catalog, name));
  throw usageError(
    `Unknown group "${name}"`,
    `${suggestions}Run "operate commands" for the groups, or search all commands with "operate commands --search ${name}".`,
  );
}

async function runCommands(
  group: string | undefined,
  command: Command,
  context: CliContext,
): Promise<void> {
  const { catalog, runtime } = context;
  const display = await displayOf(context, readGlobals(command));
  const { search, effect } = command.opts<CommandsOptions>();
  if (group !== undefined) requireGroup(catalog, group);
  const text =
    group === undefined && search === undefined && effect === undefined
      ? groupsText(discoveryGroups(catalog), display)
      : commandsText(findCommands(catalog, compact({ group, search, effect })), display);
  runtime.stdout.write(text);
}

export const commandsCommand: UtilityCommand = {
  name: 'commands',
  nested: false,
  register(program, context) {
    const command = subcommand(program, 'commands')
      .summary('List the API groups and their commands; search all commands')
      .description(DESCRIPTION)
      .usage('[group] [options]')
      .argument('[group]', 'Group whose commands to list, e.g. process-instance')
      .option(
        '--search <text>',
        'Commands whose name, alias, operationId, summary or path contain every word of the text',
      )
      .addOption(new Option('--effect <effect>', 'Commands with this effect').choices(EFFECTS));
    addGlobalOptions(command, DOCS_OPTIONS, OPTIONS_GROUP);
    setPositional(command, { kind: 'groups' });
    command.action((group: string | undefined) => runCommands(group, command, context));
  },
};
