/**
 * `pulse-cli config path|show|list|set|unset|use|delete`. The edits are the pure
 * functions of src/config/edit.ts; this module reads and writes the file (the user's config file
 * with mode 0600, with `--project` the project file, config-project.ts) and prints.
 */

import type { Command } from "commander"
import { BEARER_UNSET_KEYS } from "../../config/bearer-edit.js"
import {
  deleteProfile,
  type ProfileChanges,
  setProfile,
  unsetProfileKeys,
  useProfile,
} from "../../config/edit.js"
import { findProfile } from "../../config/resolve.js"
import { type ConfigFile, FLAVORS, PROFILE_KEYS } from "../../config/types.js"
import { checkVariableNames } from "../../config/variable.js"
import { renderValue } from "../../output/render.js"
import { compact } from "../../util.js"
import { subcommand } from "../command.js"
import type { CliContext } from "../context.js"
import { type DisplayFlags, displayOf } from "../display.js"
import { addGlobalOptions } from "../globals.js"
import { collect } from "../options.js"
import { addBearerOptions, bearerChanges } from "./config-bearer.js"
import { readSetSecrets, type SetSecrets, setNotices } from "./config-secrets.js"
import {
  checkUserProfile,
  editTarget,
  overrideNotices,
  PROJECT_OPTION,
  readTarget,
  writeTarget,
} from "./config-project.js"
import {
  configSubcommand,
  FILE_OPTIONS,
  OPTIONS_GROUP,
  registerReadCommands,
} from "./config-read.js"
import { profileView } from "./config-view.js"
import type { UtilityCommand } from "./types.js"

/** `config set` has no global `--output`: its `--output` is a profile value, `-o` the format. */
const SET_OPTIONS = ["config"]

interface SetOptions {
  readonly url?: string
  readonly engine?: string
  readonly flavor?: string
  readonly auth?: string
  readonly authUser?: string
  readonly authPasswordEnv?: string
  readonly output?: string
  readonly timeout?: string
  readonly header?: string[]
  readonly readOnly?: boolean
  readonly cockpitUrl?: string
  readonly default?: boolean
}

type Edit = (file: ConfigFile | undefined) => ConfigFile

function write(context: CliContext, text: string): void {
  context.runtime.stdout.write(text)
}

/**
 * `--config`, `--project` and the output format of an edit command: `-o/--output`, on `config
 * set` `-o` alone (its `--output` is the profile value).
 */
function editFlags(command: Command): DisplayFlags & { readonly project?: boolean } {
  const { config, output, o, project } = command.opts<{
    config?: string
    output?: string
    o?: string
    project?: boolean
  }>()
  return compact({ config, output: command.name() === "set" ? o : output, project })
}

/**
 * Reads the target file, applies the edit and writes it back. `own`: the profile the edit needs
 * in the user's file (`config unset|use|delete`); one that only the project file has asks for
 * `--project`.
 */
async function editConfig(command: Command, context: CliContext, edit: Edit, own?: string) {
  const { runtime } = context
  const flags = editFlags(command)
  const view = await displayOf(context, flags)
  const target = await editTarget(runtime, flags)
  const previous = await readTarget(runtime, target)
  if (own !== undefined) checkUserProfile(target, previous, own)
  const file = edit(previous)
  await writeTarget(runtime, target, file)
  return { file, previous, path: target.path, view, target }
}

/**
 * The changes of `config set`; only options given on the command line. The secrets are what
 * `--auth-password-stdin` and `--auth-token-stdin` read.
 */
function profileChanges(command: Command, secrets: SetSecrets): ProfileChanges {
  // --read-only is defined before --no-read-only, so neither sets a default value
  const options = command.opts<SetOptions>()
  return compact({
    ...bearerChanges(command, secrets.token),
    url: options.url,
    engine: options.engine,
    flavor: options.flavor,
    auth: options.auth,
    authUser: options.authUser,
    authPasswordEnv: options.authPasswordEnv,
    authPassword: secrets.password,
    output: options.output,
    timeout: options.timeout,
    headers: options.header,
    readOnly: options.readOnly,
    cockpitUrl: options.cockpitUrl,
    makeDefault: options.default === true ? true : undefined,
  })
}

/** An edit of profile `name`; `own`: the profile must be in the edited file (see editConfig). */
interface ProfileEdit {
  readonly name: string
  readonly edit: Edit
  readonly own?: boolean
}

/**
 * Applies the edit and prints the profile; resolves to the file before and after, and its path.
 * Notices say when the user's profile now overrides a project profile or default.
 */
async function editProfile(command: Command, context: CliContext, change: ProfileEdit) {
  const { name, edit, own } = change
  const edited = await editConfig(command, context, edit, own === true ? name : undefined)
  write(context, renderValue(profileView(edited.file, name, context.runtime.env), edited.view))
  for (const notice of overrideNotices(edited.target, name, edited.previous, edited.file)) {
    context.runtime.stderr.write(`${notice}\n`)
  }
  return edited
}

/**
 * `config set`: reads literal secrets from stdin first, refuses a secret given as the name of its
 * variable (`checkVariableNames`) before anything is stored, and warns after storing.
 */
async function setProfileFrom(name: string, command: Command, context: CliContext) {
  const { runtime } = context
  const secrets = await readSetSecrets(command, context)
  const changes = profileChanges(command, secrets)
  checkVariableNames(changes, runtime.env)
  const { file, previous, path, target } = await editProfile(command, context, {
    name,
    edit: (current) => setProfile(current, name, changes),
  })
  const before = findProfile(previous, name)
  const after = findProfile(file, name)
  const outcome = { name, path, before, after, secrets, changes, env: runtime.env }
  const created =
    target.project && previous === undefined
      ? [`Created the project file ${path}; commit it to share its profiles.`]
      : []
  for (const notice of [...created, ...setNotices(outcome)]) runtime.stderr.write(`${notice}\n`)
}

async function removeProfile(name: string, command: Command, context: CliContext): Promise<void> {
  const edit = (file: ConfigFile | undefined) => deleteProfile(file, name)
  const { path } = await editConfig(command, context, edit, name)
  context.runtime.stderr.write(`Deleted profile "${name}" from ${path}\n`)
}

function registerSet(config: Command, context: CliContext): void {
  const set = subcommand(config, "set")
    .description(
      "Create or update a profile; only the given values change. The first profile becomes the default. --output is the output format stored in the profile; -o <format> chooses how the profile is printed. Basic auth: --auth basic --auth-user <name> --auth-password-env <VAR> keeps the password in an environment variable. A bearer token from elsewhere: --auth bearer --auth-token-env <VAR>. --project writes the project file of the repository instead of your config file.",
    )
    .argument("<profile>", "Profile name, e.g. local or prod-eu")
    .option("--url <url>", "REST API root, e.g. http://localhost:8080/engine-rest")
    .option("--engine <name>", "Named process engine")
    .option("--flavor <name>", `Engine product: ${FLAVORS.join(", ")}`)
    .option("--auth <type>", "Authentication: none, basic or bearer")
    .option("--auth-user <name>", "Username for Basic auth")
    .option(
      "--auth-password-env <VAR>",
      "Name of the environment variable that holds the Basic auth password (recommended)",
    )
    .option(
      "--auth-password-stdin",
      "Store the password read from the first line of stdin (plain text in the file; discouraged)",
    )
  addBearerOptions(set)
    .option("--output <format>", "Output format to store in the profile: json or table")
    .option("--timeout <ms>", "Request timeout in milliseconds")
    .option(
      "-H, --header <header>",
      'Header "Name: value" sent with every request; repeatable',
      collect,
    )
    .option("--read-only", "Refuse every operation that is not a read")
    .option("--no-read-only", "Allow operations that change the engine state")
    .option("--cockpit-url <url>", "Base URL of the Cockpit webapp, used for links")
    .option("--default", "Make this the default profile")
    .option(...PROJECT_OPTION)
    .option("-o <format>", "Output format of the printed profile: json or table")
  addGlobalOptions(set, SET_OPTIONS, OPTIONS_GROUP)
  set.action((name: string) => setProfileFrom(name, set, context))
}

function registerEditCommands(config: Command, context: CliContext): void {
  registerSet(config, context)
  const unset = configSubcommand(
    config,
    "unset",
    "Remove values from a profile; auth removes all auth settings, token (or tokenEnv) the bearer token",
    FILE_OPTIONS,
  )
    .argument("<profile>", "Profile name")
    .argument(
      "<keys...>",
      `Keys to remove: ${PROFILE_KEYS.join(", ")}; bearer token: ${BEARER_UNSET_KEYS.join(", ")}`,
    )
  unset.option(...PROJECT_OPTION)
  unset.action(async (name: string, keys: string[]) => {
    const edit = (file: ConfigFile | undefined) => unsetProfileKeys(file, name, keys)
    await editProfile(unset, context, { name, edit, own: true })
  })
  const use = configSubcommand(config, "use", "Make a profile the default", FILE_OPTIONS)
  use.argument("<profile>", "Profile name").option(...PROJECT_OPTION)
  use.action(async (name: string) => {
    const edit = (file: ConfigFile | undefined) => useProfile(file, name)
    await editProfile(use, context, { name, edit, own: true })
  })
  const remove = configSubcommand(config, "delete", "Delete a profile", FILE_OPTIONS)
  remove.argument("<profile>", "Profile name").option(...PROJECT_OPTION)
  remove.action((name: string) => removeProfile(name, remove, context))
}

export const configCommand: UtilityCommand = {
  name: "config",
  nested: true,
  register(program, context) {
    const config = subcommand(program, "config")
      .summary("Manage the config file and its profiles")
      .description(
        "Manage the config file and its profiles. The file is written with mode 0600; values are validated before they are stored. A repository can share profiles in a project file (.pulse-cli.json, written with --project); your own profiles of the same name override them.",
      )
    registerReadCommands(config, context)
    registerEditCommands(config, context)
  },
}
