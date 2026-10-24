/**
 * Error handling of `run()`: commander exits become exit code 0 (help, version) or USAGE errors
 * with a hint (design §2.7); everything is rendered by `renderError` in the best known format.
 */

import type { Command, CommanderError } from 'commander';
import { type OperateError, usageError } from '../errors.js';
import { renderError, toOperateError } from '../output/error.js';
import { terminalSafe } from '../output/terminal.js';
import type { Runtime } from '../runtime.js';
import { closeNames } from '../util.js';
import { globalFromArgv, outputFromArgv, verboseRequested } from './argv.js';
import type { CliState } from './context.js';
import { commandPath } from './help.js';
import { envFormat, profileFormat, terminalFormat } from './output-format.js';
import { WORKFLOW_GROUP } from '../docs/workflow.js';
import { didYouMean } from './commands/suggest.js';
import { authFlagFor, mentionsSecret, optionName, secretHint, stdinHint } from './secret-flags.js';

/** commander exits that are answers, not errors. */
const DISPLAY_CODES: ReadonlySet<string> = new Set([
  'commander.help',
  'commander.helpDisplayed',
  'commander.version',
]);

/** A commander exit together with the command that raised it (for the hint). */
export class CommandExit extends Error {
  readonly exit: CommanderError;
  readonly command: Command;

  constructor(exit: CommanderError, command: Command) {
    super(exit.message);
    this.name = 'CommandExit';
    this.exit = exit;
    this.command = command;
  }
}

/** exitOverride callback for `command`: throws instead of exiting the process. */
export function exitHandler(command: Command): (exit: CommanderError) => never {
  return (exit) => {
    throw new CommandExit(exit, command);
  };
}

/** True for help and version output, which end the run with exit code 0. */
export function isDisplayExit(error: unknown): boolean {
  return error instanceof CommandExit && DISPLAY_CODES.has(error.exit.code);
}

/** The quoted name of commander's unknown command / unknown option message. */
function unknownName(message: string): string {
  return /'([^']*)'/.exec(message)?.[1] ?? '';
}

/** Names and aliases of the subcommands of `command`. */
function subcommandNames(command: Command): string[] {
  return command.commands.flatMap((sub) => [sub.name(), ...sub.aliases()]);
}

/** The long flags of the options of `command`. */
function optionNames(command: Command): string[] {
  return command.options.flatMap((option) => (option.long === undefined ? [] : [option.long]));
}

function usageHint(command: Command): string {
  return `Run "${commandPath(command)} --help" for the usage.`;
}

function commandsHint(command: Command): string {
  const word = command.args[0] ?? '';
  return `Run "${commandPath(command)} --help" for the commands, or search all commands with "operate commands --search ${word}".`;
}

function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** `operate auth` and its subcommands: an extra word there is most likely a token. */
function isAuthCommand(command: Command): boolean {
  return command.name() === 'auth' || command.parent?.name() === 'auth';
}

const STATUS_TOKEN_HINT = `operate auth status takes no token argument: pipe the token into --auth-token-stdin, e.g. printf '%s\\n' "$TOKEN" | operate auth status --auth-token-stdin. `;

/**
 * Too many arguments. Next to an option about a secret, `--auth bearer` or on an `auth` command
 * the extra values are left out: the most likely one is a password or token given to a flag that
 * takes none (`--auth-password-stdin`, `--auth-token-stdin`), after `--auth bearer`, or to `auth
 * status`.
 */
function excessArguments(text: string, command: Command, argv: readonly string[]): OperateError {
  const status = isAuthCommand(command) && command.name() === 'status' ? STATUS_TOKEN_HINT : '';
  const hint = `${stdinHint(argv)}${status}${usageHint(command)}`;
  if (!mentionsSecret(argv) && !isAuthCommand(command)) {
    return usageError(capitalized(text), hint);
  }
  return usageError(capitalized(text.replace(/: .*/s, '.')), hint);
}

/**
 * An unknown command. Next to an option about a secret, `--auth bearer` or under `auth` the word
 * is not repeated (`operate --auth-token-stdin $TOKEN task list` makes the token the command
 * name); suggestions name known commands only, so they stay.
 */
function unknownCommand(name: string, command: Command, argv: readonly string[]): OperateError {
  const suggestions = didYouMean(closeNames(name, subcommandNames(command)));
  if (!mentionsSecret(argv) && !isAuthCommand(command)) {
    return usageError(`Unknown command "${name}"`, `${suggestions}${commandsHint(command)}`);
  }
  return usageError(
    'Unknown command (not repeated: it may be a token or password)',
    `${suggestions}${stdinHint(argv)}Run "${commandPath(command)} --help" for the commands.`,
  );
}

/**
 * An unknown option, without the value of `--name=value` (it may be a password). A known option
 * with a value is a flag that takes none (`--dry-run=x`, `--auth-password-stdin=<password>`).
 * Suggestions: the `--auth-*` flag of a renamed name (`--username`), then close spellings.
 */
function unknownOption(text: string, command: Command): OperateError {
  const name = optionName(unknownName(text));
  const known = optionNames(command);
  const help = usageHint(command);
  if (known.includes(name)) {
    return usageError(`Option "${name}" takes no value`, `${secretHint(name)}${help}`);
  }
  const renamed = authFlagFor(name, known);
  const suggestions = didYouMean([...new Set([...renamed, ...closeNames(name, known)])]);
  const secret = renamed.length > 0 ? '' : secretHint(name);
  return usageError(`Unknown option "${name}"`, `${suggestions}${secret}${help}`);
}

/** `operate workflow <x>`: the workflow commands are top-level commands. */
function workflowGroupError(argv: readonly string[]): OperateError {
  const next = argv[argv.indexOf(WORKFLOW_GROUP.group) + 1];
  const command = next === undefined || next.startsWith('-') ? '<command>' : next;
  return usageError(
    'Unknown command "workflow"',
    `Workflow commands are top-level: operate ${command}. "operate commands workflow" lists them.`,
  );
}

/**
 * commander's message without its `error: ` prefix and capitalized. Unknown commands and options
 * read `Unknown command "tsk"`; their suggestions (the same `closeNames` rule as everywhere) go
 * into the hint, like the suggestions of `commands` and `describe`. `argv` tells whether the
 * command line has an option about a secret.
 */
export function commanderUsageError(
  error: CommandExit,
  argv: readonly string[] = [],
): OperateError {
  const { exit, command } = error;
  const text = exit.message.replace(/^error: /, '').replace(/\n\(Did you mean[^)]*\)$/, '');
  if (exit.code === 'commander.excessArguments') return excessArguments(text, command, argv);
  if (exit.code === 'commander.unknownOption') return unknownOption(text, command);
  if (exit.code !== 'commander.unknownCommand') {
    return usageError(capitalized(text), usageHint(command));
  }
  const name = unknownName(text);
  if (name === WORKFLOW_GROUP.group) return workflowGroupError(argv);
  return unknownCommand(name, command, argv);
}

/**
 * Format for errors (design §2.6 order): the resolved one when a command got that far, else
 * `-o/--output` from argv, else OPERATE_OUTPUT, else the profile's output (best effort), else json
 * unless stdout is a terminal. Never fails.
 */
export async function errorFormat(argv: readonly string[], runtime: Runtime, state: CliState) {
  return (
    state.format ??
    outputFromArgv(argv) ??
    envFormat(runtime, false) ??
    (await profileFormat(runtime, {
      config: globalFromArgv(argv, 'config'),
      profile: globalFromArgv(argv, 'profile'),
    })) ??
    terminalFormat(runtime)
  );
}

/** Writes the error to stderr and resolves to the exit code (0 for help and version). */
export async function reportError(
  error: unknown,
  argv: readonly string[],
  runtime: Runtime,
  state: CliState,
): Promise<number> {
  if (isDisplayExit(error)) return 0;
  const operateError =
    error instanceof CommandExit ? commanderUsageError(error, argv) : toOperateError(error);
  const format = await errorFormat(argv, runtime, state);
  const text = renderError(operateError, format, verboseRequested(argv));
  runtime.stderr.write(runtime.stderr.isTTY ? terminalSafe(text) : text);
  return operateError.exitCode;
}
