/**
 * The one warning of a run that uses the names pulse-cli had up to 0.10.0 (config/legacy.ts names
 * them): written to stderr before the command, also when stderr is no terminal, since scripts and
 * CI are where old names linger. On a terminal through terminalSafe, as every other text.
 */

import { legacyWarning, type LegacyUse } from "../config/legacy.js"
import { terminalSafe } from "../output/terminal.js"
import type { Runtime } from "../runtime.js"
import { globalFromArgv } from "./argv.js"
import { legacyFileUses } from "./config-files.js"

/** Writes the warning for `uses` and the legacy files the run reads; nothing when there are none. */
export async function warnLegacyNames(
  argv: readonly string[],
  runtime: Runtime,
  uses: readonly LegacyUse[],
): Promise<void> {
  const files = await legacyFileUses(runtime, globalFromArgv(argv, "config")).catch(() => [])
  const warning = legacyWarning([...uses, ...files])
  if (warning === undefined) return
  runtime.stderr.write(`${runtime.stderr.isTTY ? terminalSafe(warning) : warning}\n`)
}
