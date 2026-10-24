/**
 * The output format rule, in one place for every entry point: `-o/--output` >
 * OPERATE_OUTPUT > the `output` of the selected profile > table on a terminal, JSON otherwise.
 * Operation commands resolve it with the configuration (strict), the docs commands and errors
 * raised before a command got that far use the same order (errors never fail on a bad value).
 */

import { selectProfile, validateOutput } from "../config/resolve.js"
import { ENV, OUTPUT_FORMATS, type OutputFormat } from "../config/types.js"
import type { Runtime } from "../runtime.js"
import { loadConfig } from "./config-files.js"

/** Table width when stdout is not a terminal, or one that reports no usable width. */
const DEFAULT_WIDTH = 120

/**
 * The terminal width of stdout, if it is a terminal that reports one. Pseudo terminals of `script`,
 * `docker exec -t` and some CI runners report 0 columns, which counts as unknown.
 */
export function terminalColumns(runtime: Runtime): number | undefined {
  const { columns } = runtime.stdout
  return runtime.stdout.isTTY && columns !== undefined && columns > 0 ? columns : undefined
}

/** Maximum table width: the terminal width, else 120. */
export function maxWidthOf(runtime: Runtime): number {
  return terminalColumns(runtime) ?? DEFAULT_WIDTH
}

/** table on a terminal, JSON otherwise. */
export function terminalFormat(runtime: Runtime): OutputFormat {
  return runtime.stdout.isTTY ? "table" : "json"
}

/** OPERATE_OUTPUT (trimmed, blank = unset). `strict`: an unknown value is a CONFIG error. */
export function envFormat(runtime: Runtime, strict: boolean): OutputFormat | undefined {
  const value = runtime.env[ENV.output]?.trim()
  if (value === undefined || value === "") return undefined
  return strict ? validateOutput(value) : OUTPUT_FORMATS.find((format) => format === value)
}

/** Where the profile comes from: `--config` and `--profile` as given on the command line. */
export interface ProfileFlags {
  readonly config?: string | undefined
  readonly profile?: string | undefined
}

/**
 * The `output` of the selected profile, best effort: commands that need no configuration (and
 * errors) must not fail because of the config file, so every problem counts as "not set".
 */
export async function profileFormat(
  runtime: Runtime,
  flags: ProfileFlags,
): Promise<OutputFormat | undefined> {
  try {
    const { config } = await loadConfig(runtime, flags.config)
    const selected = selectProfile(
      flags.profile === undefined ? {} : { profile: flags.profile },
      runtime.env,
      config,
    )
    return selected.profile?.output
  } catch {
    return undefined
  }
}
