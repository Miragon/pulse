/**
 * The engine adapter of a run, chosen before the commands are registered: `--flavor`, then
 * PULSE_CLI_FLAVOR, then the `flavor` of the selected profile, else camunda7.
 */

import { resolveFlavor, selectProfile } from "../config/resolve.js"
import type { Profile } from "../config/types.js"
import type { EngineAdapter } from "../engine-port/engine-adapter.js"
import { ENGINES } from "../engines/index.js"
import type { Runtime } from "../runtime.js"
import { compact } from "../util.js"
import { globalFromArgv } from "./argv.js"
import { loadConfig } from "./config-files.js"

/**
 * The selected profile, or none when the config cannot be read: the command reports that problem
 * when it resolves its configuration, and commands such as `config set` must still run.
 */
async function profileOf(argv: readonly string[], runtime: Runtime): Promise<Profile | undefined> {
  try {
    const files = await loadConfig(runtime, globalFromArgv(argv, "config"))
    const flags = compact({ profile: globalFromArgv(argv, "profile") })
    return selectProfile(flags, runtime.env, files.config).profile
  } catch {
    return undefined
  }
}

export async function selectEngine(
  argv: readonly string[],
  runtime: Runtime,
): Promise<EngineAdapter> {
  const flags = compact({ flavor: globalFromArgv(argv, "flavor") })
  const flavor = resolveFlavor(flags, runtime.env, await profileOf(argv, runtime))
  return ENGINES[flavor.value]
}
