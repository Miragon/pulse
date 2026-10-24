/**
 * Entry point of the CLI: parses the arguments, runs the command and turns every outcome into an
 * exit code. Errors are rendered to stderr by `renderError`, never printed directly.
 */

import { isLegacyProgram, LEGACY_PROGRAM_USE, withLegacyEnv } from "../config/legacy.js"
import { DEFAULT_FLAVOR } from "../config/types.js"
import type { EngineAdapter } from "../engine-port/engine-adapter.js"
import { ENGINES } from "../engines/index.js"
import { EXIT_CODES } from "../errors.js"
import type { Runtime } from "../runtime.js"
import { normalizeArgv } from "./argv.js"
import { COMPLETE_COMMAND, runComplete } from "./completion-model.js"
import type { CliContext, CliState } from "./context.js"
import { reportError } from "./errors.js"
import { selectEngine } from "./flavor.js"
import { warnLegacyNames } from "./legacy-notice.js"
import { createProgram, hasSubcommands } from "./program.js"

function contextOf(runtime: Runtime, engine: EngineAdapter, state: CliState): CliContext {
  return { runtime, engine, catalog: engine.catalog, state }
}

export interface RunOptions {
  /** How the shell named the program (process.argv[1]); the old name LEGACY_PROGRAM warns. */
  readonly invokedAs?: string | undefined
}

/**
 * Runs `pulse-cli <argv...>` and resolves to the exit code. Never rejects. The environment is read
 * through withLegacyEnv until LEGACY_REMOVAL, and a run that uses an old name warns once.
 */
export async function run(
  argv: readonly string[],
  given: Runtime,
  options: RunOptions = {},
): Promise<number> {
  const legacy = withLegacyEnv(given.env)
  const runtime: Runtime = legacy.env === given.env ? given : { ...given, env: legacy.env }
  const state: CliState = { argv }
  if (argv[0] === COMPLETE_COMMAND) {
    const engine = await selectEngine(argv, runtime).catch(() => ENGINES[DEFAULT_FLAVOR])
    await runComplete(argv.slice(1), contextOf(runtime, engine, state))
    return EXIT_CODES.ok
  }
  const program = isLegacyProgram(options.invokedAs) ? [LEGACY_PROGRAM_USE] : []
  await warnLegacyNames(argv, runtime, [...program, ...legacy.uses])
  try {
    const context = contextOf(runtime, await selectEngine(argv, runtime), state)
    const args = normalizeArgv(argv, (name) => hasSubcommands(context.catalog, name))
    await createProgram(args, context).parseAsync(args, { from: "user" })
    return EXIT_CODES.ok
  } catch (error) {
    return reportError(error, argv, runtime, state)
  }
}
