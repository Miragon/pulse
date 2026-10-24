/**
 * Operation commands generated from the catalog: arguments and options from src/docs/options.ts,
 * the global options, and an action that builds the input, executes and prints the result.
 */

import type { Command } from 'commander';
import { requiresConfirmation } from '../catalog/rules.js';
import type { OperationSpec } from '../catalog/types.js';
import { examplesFor } from '../docs/examples.js';
import {
  type ArgumentDoc,
  argumentSyntax,
  operationArguments,
  operationOptions,
} from '../docs/options.js';
import { commandRef } from '../operation/command-ref.js';
import { executeOperation } from '../operation/execute.js';
import { buildInput } from '../operation/input.js';
import { subcommand } from './command.js';
import { setPositional } from './completion-meta.js';
import type { CliContext } from './context.js';
import { emitResult } from './emit.js';
import { addGlobalOptions, readGlobals } from './globals.js';
import { examplesText } from './help.js';
import { addOperationOptions, commandValues, type RegisteredOption } from './options.js';
import { clientOf, guardsOf, openSession, type Session, targetOf } from './session.js';

/** Line in the command list of the group help. */
export function operationSummary(operation: {
  readonly summary: string;
  readonly method: string;
  readonly path: string;
  readonly deprecated: boolean;
}): string {
  const summary =
    operation.summary === '' ? `${operation.method} ${operation.path}` : operation.summary;
  return operation.deprecated ? `[deprecated] ${summary}` : summary;
}

/**
 * The commander syntax of an argument. Resource files are optional for commander, so that a call
 * without files gets the error of src/operation/multipart.ts with its example; the usage line
 * still shows `<files...>`.
 */
function registeredSyntax(argument: ArgumentDoc): string {
  return argument.variadic ? `[${argument.name}...]` : argumentSyntax(argument);
}

/** Help description: summary, method and path, effect, aliases. */
export function operationDescription(operation: OperationSpec): string {
  const effect = requiresConfirmation(operation.effect)
    ? `${operation.effect} (requires --yes)`
    : operation.effect;
  const aliases = operation.aliases.length > 0 ? [`Aliases: ${operation.aliases.join(', ')}`] : [];
  return [
    operationSummary(operation),
    '',
    `${operation.method} ${operation.path}`,
    `Effect: ${effect}`,
    ...aliases,
  ].join('\n');
}

/** XML property to print raw, unless JSON was asked for explicitly or --fields is given. */
function unwrapOf(operation: OperationSpec, session: Session): string | undefined {
  const explicitJson = session.config.output === 'json' || session.globals.fields !== undefined;
  return explicitJson ? undefined : operation.unwrap;
}

async function runOperation(
  operation: OperationSpec,
  command: Command,
  registered: readonly RegisteredOption[],
  context: CliContext,
): Promise<void> {
  const { runtime } = context;
  const values = commandValues(command, registered);
  const session = await openSession(context, readGlobals(command), {
    bodyFromStdin: values.flags.body === '-',
  });
  const input = await buildInput(operation, values, {
    fs: runtime.fs,
    readStdin: () => runtime.readStdin(),
  });
  const result = await executeOperation(operation, input, {
    target: targetOf(session),
    client: clientOf(session, runtime),
    ...guardsOf(session),
    all: values.flags.all === true,
    validate: values.flags.validate !== false,
    schemas: context.catalog.schemas,
    ref: commandRef(operation, context.catalog),
  });
  await emitResult(result, session, runtime, unwrapOf(operation, session));
}

/** Registers the command of one catalog operation in its group command. */
export function registerOperation(
  group: Command,
  operation: OperationSpec,
  context: CliContext,
): Command {
  const args = operationArguments(operation);
  const command = subcommand(group, operation.name)
    .aliases(operation.aliases)
    .summary(operationSummary(operation))
    .description(operationDescription(operation))
    .usage([...args.map(argumentSyntax), '[options]'].join(' '));
  for (const argument of args) command.argument(registeredSyntax(argument), argument.description);
  if (args.some((argument) => argument.variadic))
    setPositional(command, { kind: 'path', path: 'files' });
  const registered = addOperationOptions(
    command,
    operationOptions(operation, context.catalog.schemas),
  );
  addGlobalOptions(command);
  command.addHelpText('after', () => examplesText(examplesFor(operation, context.catalog.schemas)));
  command.action(() => runOperation(operation, command, registered, context));
  return command;
}
