/**
 * The reading `pulse-cli config` commands: `config path` (the user's config file,
 * with `--project` the project file), `config show` (the effective configuration with the source
 * of every value and the files it comes from) and `config list` (the profiles of both files).
 */

import type { Command } from "commander"
import { listProfiles, showConfig } from "../../config/edit.js"
import { validateOutput } from "../../config/resolve.js"
import { renderValue } from "../../output/render.js"
import { compact } from "../../util.js"
import { subcommand } from "../command.js"
import { loadConfig, userConfig } from "../config-files.js"
import type { CliContext } from "../context.js"
import { displayOf } from "../display.js"
import { addGlobalOptions, readGlobals } from "../globals.js"
import { maxWidthOf } from "../output-format.js"
import { openSession } from "../session.js"
import { editTarget, PROJECT_OPTION } from "./config-project.js"
import { maskedView, showHeader, showRows } from "./config-view.js"

/**
 * Global options accepted by `config show`: the config related ones. Config commands inherit
 * `-h, --help` from the program, under the same "Options:" heading.
 */
const SHOW_OPTIONS = [
  "url",
  "engine",
  "flavor",
  "profile",
  "config",
  "output",
  "timeout",
  "header",
  "auth",
  "auth-user",
  "auth-password-stdin",
  "auth-token-stdin",
  "read-only",
  "show-secrets",
]
/** Global options of the other config commands; `-o/--output` only chooses the output format. */
export const FILE_OPTIONS = ["config", "output"]

function write(context: CliContext, text: string): void {
  context.runtime.stdout.write(text)
}

/**
 * The user's config file in effect with `--project` the
 * project file (the one in effect, else a new one).
 */
async function printPath(command: Command, context: CliContext): Promise<void> {
  const globals = readGlobals(command)
  const view = await displayOf(context, globals)
  const { project } = command.opts<{ project?: boolean }>()
  const path =
    project === true
      ? (await editTarget(context.runtime, { ...compact({ config: globals.config }), project }))
          .path
      : userConfig(context.runtime, globals.config)
  write(context, view.format === "json" ? renderValue({ path }, view) : `${path}\n`)
}

/**
 * `-o` only chooses how `config show` prints: the values are what an operation command resolves
 * without it (PULSE_CLI_OUTPUT, the profile's output or the default).
 */
async function printConfig(command: Command, context: CliContext): Promise<void> {
  const { output, ...globals } = readGlobals(command)
  const display = output === undefined ? undefined : validateOutput(output)
  const session = await openSession(context, globals)
  const format = display ?? session.format
  context.state.format = format
  const view = maskedView(
    showConfig(session.config, session.configPath, session.projectPath),
    globals.showSecrets,
  )
  const options = { format, pretty: session.pretty, maxWidth: maxWidthOf(context.runtime) }
  write(
    context,
    format === "json"
      ? renderValue(view, options)
      : `${showHeader(view)}${renderValue(showRows(view), options)}`,
  )
}

/** The profiles of the project file and the user's config file (or the named file). */
async function printProfiles(command: Command, context: CliContext): Promise<void> {
  const globals = readGlobals(command)
  const view = await displayOf(context, globals)
  const { config } = await loadConfig(context.runtime, globals.config)
  write(context, renderValue(listProfiles(config), view))
}

/** Heading of the own options of config commands (commander's default). */
export const OPTIONS_GROUP = "Options:"

export function configSubcommand(
  parent: Command,
  name: string,
  description: string,
  options: string[],
) {
  return addGlobalOptions(subcommand(parent, name).description(description), options, OPTIONS_GROUP)
}

export function registerReadCommands(config: Command, context: CliContext): void {
  const path = configSubcommand(
    config,
    "path",
    "Print the location of your config file; with --project the project file in effect, else where `config set --project` creates one",
    FILE_OPTIONS,
  ).option(
    PROJECT_OPTION[0],
    "Print the project file (.pulse-cli.json from the working directory up to the repository root)",
  )
  path.action(() => printPath(path, context))
  const show = configSubcommand(
    config,
    "show",
    "Print the effective configuration and where each value comes from; header values, the password, the client secret and the bearer token are masked unless --show-secrets. -o only formats this output: the values are what an operation command resolves without it.",
    SHOW_OPTIONS,
  )
  show.action(() => printConfig(show, context))
  const list = configSubcommand(
    config,
    "list",
    "List the profiles of your config file and of the project file (scope user or project)",
    FILE_OPTIONS,
  )
  list.action(() => printProfiles(list, context))
}
