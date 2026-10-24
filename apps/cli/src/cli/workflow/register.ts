/**
 * Commander wiring of the workflow commands (design §17.1): registered eagerly from their
 * WORKFLOW_DOCS entry with their own options and every global option, under the root help heading
 * "Workflow commands:". The action opens the session, checks the guard and prints the result.
 */

import type { Command } from "commander"
import type { Effect } from "../../catalog/types.js"
import { argumentSyntax } from "../../docs/options.js"
import { type WorkflowDoc, workflowDescription } from "../../docs/workflow.js"
import type { EnginePort } from "../../engine-port/engine-port.js"
import type { CommandValues } from "../../operation/command-values.js"
import { checkEffect } from "../../operation/guards.js"
import type { Runtime } from "../../runtime.js"
import { dryRunOutput, dryRunText } from "../../workflow/dry-run.js"
import type { WorkflowResult } from "../../workflow/types.js"
import type { WaitDeps } from "../../workflow/wait.js"
import { subcommand } from "../command.js"
import { setPositional } from "../completion-meta.js"
import type { CliContext } from "../context.js"
import { addGlobalOptions, readGlobals } from "../globals.js"
import { examplesText } from "../help.js"
import { addOperationOptions, commandValues, type RegisteredOption } from "../options.js"
import { clientOf, guardsOf, openSession, type Session, targetOf } from "../session.js"
import { emitView } from "./emit-view.js"

const WORKFLOW_HEADING = "Workflow commands:"

/** What a workflow command action gets. */
export interface WorkflowRun {
  /** The command name, e.g. `advance`. */
  readonly name: string
  readonly context: CliContext
  readonly session: Session
  readonly values: CommandValues
  readonly port: EnginePort
  readonly deps: WaitDeps
}

export type WorkflowAction = (run: WorkflowRun) => Promise<void>

/**
 * The `--dry-run` view (with the auth notes on stderr) or the command's view, printed; a failure
 * (exit 9) after its view.
 */
export async function emitResult<V>(
  run: WorkflowRun,
  result: WorkflowResult<V>,
  text: (view: V, maxWidth: number) => string,
): Promise<void> {
  const { session, context } = run
  const runtime: Runtime = context.runtime
  if (result.kind === "dry-run") {
    const { view, notes } = await dryRunOutput(result, run.port, session.globals.showSecrets)
    await emitView(view, () => dryRunText(view), session, runtime)
    for (const note of notes) runtime.stderr.write(`Note: ${note}\n`)
    return
  }
  await emitView(result.view, (maxWidth) => text(result.view, maxWidth), session, runtime)
  if (result.failure !== undefined) throw result.failure
}

/** The guard of §2.3 with the effect the options give, before the first request. */
export function guard(run: WorkflowRun, effect: Effect): void {
  checkEffect(effect, `operate ${run.name}`, guardsOf(run.session))
}

async function start(
  command: Command,
  registered: readonly RegisteredOption[],
  context: CliContext,
  name: string,
): Promise<WorkflowRun> {
  const values = commandValues(command, registered)
  const session = await openSession(context, readGlobals(command))
  const { runtime } = context
  const port = context.engine.port(targetOf(session), clientOf(session, runtime))
  const deps: WaitDeps = {
    port,
    now: () => runtime.now(),
    sleep: (ms) => runtime.sleep(ms),
    // a human at a terminal sees that operate waits; pipes stay silent
    ...(runtime.stderr.isTTY
      ? {
          notice: (line: string) => {
            runtime.stderr.write(`${line}\n`)
          },
        }
      : {}),
  }
  return { name, context, session, values, port, deps }
}

/** Registers a workflow command from its docs entry with `action`. */
export function registerWorkflow(
  program: Command,
  doc: WorkflowDoc,
  context: CliContext,
  action: WorkflowAction,
): Command {
  const command = subcommand(program, doc.name)
    .summary(doc.summary)
    .description(workflowDescription(doc))
    .usage(
      [
        ...doc.arguments.map((argument) =>
          argument.required
            ? argumentSyntax(argument)
            : `[${argument.name}${argument.variadic ? "..." : ""}]`,
        ),
        "[options]",
      ].join(" "),
    )
    .helpGroup(WORKFLOW_HEADING)
  for (const argument of doc.arguments) {
    const name = `${argument.name}${argument.variadic ? "..." : ""}`
    command.argument(argument.required ? `<${name}>` : `[${name}]`, argument.description)
    if (argument.complete !== undefined)
      setPositional(command, { kind: "path", path: argument.complete })
  }
  const registered = addOperationOptions(command, doc.options)
  addGlobalOptions(command)
  command.addHelpText("after", () => examplesText(doc.examples))
  command.action(async () => action(await start(command, registered, context, doc.name)))
  return command
}
