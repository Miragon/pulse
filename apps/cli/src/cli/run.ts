/**
 * Entry point of the CLI: parses the arguments, runs the command and turns every outcome into an
 * exit code. Errors are rendered to stderr by `renderError` (design §2.7), never printed directly.
 */

import { DEFAULT_PLATFORM } from "../config/types.js"
import type { EngineAdapter } from "../engine-port/engine-adapter.js"
import { ENGINES } from "../engines/index.js"
import { EXIT_CODES } from "../errors.js"
import type { Runtime } from "../runtime.js"
import { normalizeArgv } from "./argv.js"
import { COMPLETE_COMMAND, runComplete } from "./completion-model.js"
import type { CliContext, CliState } from "./context.js"
import { reportError } from "./errors.js"
import { selectEngine } from "./platform.js"
import { createProgram, hasSubcommands } from "./program.js"

function contextOf(runtime: Runtime, engine: EngineAdapter, state: CliState): CliContext {
  return { runtime, engine, catalog: engine.catalog, state }
}

/** Runs `operate <argv...>` and resolves to the exit code. Never rejects. */
export async function run(argv: readonly string[], runtime: Runtime): Promise<number> {
  const state: CliState = { argv }
  if (argv[0] === COMPLETE_COMMAND) {
    const engine = await selectEngine(argv, runtime).catch(() => ENGINES[DEFAULT_PLATFORM])
    await runComplete(argv.slice(1), contextOf(runtime, engine, state))
    return EXIT_CODES.ok
  }
  try {
    const context = contextOf(runtime, await selectEngine(argv, runtime), state)
    const args = normalizeArgv(argv, (name) => hasSubcommands(context.catalog, name))
    await createProgram(args, context).parseAsync(args, { from: "user" })
    return EXIT_CODES.ok
  } catch (error) {
    return reportError(error, argv, runtime, state)
  }
}
