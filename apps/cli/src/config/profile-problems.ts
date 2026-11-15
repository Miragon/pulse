/**
 * How the CLI words what @miragon/pulse-profile finds: the format's sentence
 * (`describeProblem`, which names the key and never a value, a variable or a profile name) with
 * the CLI's context in front (the file, the profile) and its way out behind (a `pulse config`
 * command, a flag, a PULSE_CLI_* variable). A profile name is shown only when it is a valid one.
 */

import {
  describeProblem,
  type Problem,
  type ProblemCode,
  PROFILE_NAME,
} from "@miragon/pulse-profile"
import type { PulseCliError } from "../errors.js"
import { configError } from "./config-error.js"
import { AUTH_TYPES, ENV, FLAVORS, type LoadedConfig } from "./types.js"

/** The problems of a profile as one text: the format's sentences in order. */
export function describeProblems(problems: readonly Problem[]): string {
  return problems.map(describeProblem).join(" ")
}

/** A file that gives no profiles at all: invalid JSON, a wrong outer shape, a root key twice. */
export function invalidFileError(project: boolean, path: string, problem: Problem): PulseCliError {
  const kind = project ? "project file" : "config file"
  const recreate = project ? "`pulse config set <profile> --project`" : "`pulse config set`"
  return configError(
    `Invalid ${kind} ${path}: ${describeProblem(problem)}`,
    `Fix the file or recreate it with ${recreate}.`,
  )
}

/** Where a profile comes from, for messages: the project file, a named config file or yours. */
export interface ProfileOrigin {
  /** The project file it comes from. */
  readonly project?: string | undefined
  /** The config file named by --config or PULSE_CLI_CONFIG it comes from. */
  readonly configFile?: string | undefined
  /** It was selected as the defaultProfile of the project file or of the config file. */
  readonly defaultOf?: "project" | "config" | undefined
}

/** The file a profile comes from as messages name it: `your config file` for the user's own. */
export function fileOf(origin: ProfileOrigin): string {
  if (origin.project !== undefined) return `the project file ${origin.project}`
  return origin.configFile === undefined
    ? "your config file"
    : `the config file ${origin.configFile}`
}

/** Where a credential a project file must not name comes from instead. */
const CREDENTIAL_SOURCES: Readonly<Record<string, string>> = {
  "auth.password": ENV.password,
  "auth.passwordEnv": ENV.password,
  "auth.clientSecret": ENV.oauthClientSecret,
  "auth.clientSecretEnv": ENV.oauthClientSecret,
  "auth.token": `${ENV.token} or ${ENV.tokenCommand}`,
  "auth.tokenEnv": `${ENV.token} or ${ENV.tokenCommand}`,
}

/** The option of `pulse config set` that sets a key. */
const SET_OPTIONS: Readonly<Record<string, string>> = {
  url: "--url <url>",
  cockpitUrl: "--cockpit-url <url>",
  engine: "--engine <name>",
  flavor: "--flavor <name>",
  output: "--output <format>",
  timeout: "--timeout <ms>",
  readOnly: "--read-only",
  headers: "-H 'Name: value'",
}

/**
 * The way out of a problem a code has one for, by code; `flag` is " --project" or "", `use` the
 * way to make another profile the default when the file's defaultProfile chose it, else "".
 */
const CODE_HINTS: Readonly<
  Partial<Record<ProblemCode, (name: string, flag: string, use: string) => string>>
> = {
  "secret-header": (name, flag) =>
    `A project file is shared, so secret headers go into ${ENV.headers} or a profile of your own config file. Remove it with \`pulse config unset ${name} headers${flag}\`.`,
  "auth-type-not-served": (name, flag) => authTypeHint(name, flag),
  "auth-type-unknown": (name, flag) => authTypeHint(name, flag),
  "auth-type-not-in-dialect": (name, flag) =>
    `Fix auth.type or flavor in the file, or remove all auth settings with \`pulse config unset ${name} auth${flag}\`.`,
  "token-endpoint-missing": () =>
    "Set auth.tokenEndpoint in the file: pulse config does not edit client credentials.",
  "dialect-not-served": (_name, _flag, use) =>
    `The CLI reads engines of the Camunda 7 REST API (${FLAVORS.join(", ")}) and leaves this profile as it stands for Pulse for VS Code and Pulse for Orca, which read Camunda 8 too: choose another one with --profile or ${ENV.profile}${use}, or give --url, which selects no profile.`,
}

/** The file whose defaultProfile chose a profile: the project file when it names one, else yours. */
export function defaultFileOf(config: LoadedConfig): "project" | "config" {
  return config.project?.defaultProfile === true ? "project" : "config"
}

/** How to make another profile the default of the file whose defaultProfile chose this one. */
function useHint(defaultOf: ProfileOrigin["defaultOf"]): string {
  if (defaultOf === undefined) return ""
  const flag = defaultOf === "project" ? " --project" : ""
  return `, make another one the default with \`pulse config use <profile>${flag}\``
}

function authTypeHint(name: string, flag: string): string {
  return `The CLI authenticates with ${AUTH_TYPES.join(", ")} (passthrough is the MCP server's): \`pulse config set ${name} --auth <type>${flag}\`. A bearer token itself goes into ${ENV.token} or --auth-token-stdin.`
}

/** The entry of `table` for `key`; own entries only, so `constructor` finds none. */
function entryOf(table: Readonly<Record<string, string>>, key: string): string | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

/** The way out of a problem about one key: where a credential comes from, unset or set it. */
function keyHint(name: string, problem: Problem, flag: string): string | undefined {
  const key = problem.key ?? ""
  const source = entryOf(CREDENTIAL_SOURCES, key)
  if (problem.code === "credential-in-shared-file" && source !== undefined) {
    return `A project file is shared and names no credentials: they come from the environment (${source}) or a profile "${name}" of your own config file. Remove it with \`pulse config unset ${name} auth${flag}\`, and a committed secret from the history of your repository too.`
  }
  if (problem.code === "unknown-key" && key !== "") {
    return `Remove it with \`pulse config unset ${name} ${key}${flag}\`, or fix its spelling in the file.`
  }
  const option = entryOf(SET_OPTIONS, key)
  return option === undefined
    ? undefined
    : `Fix it in the file, or set it with \`pulse config set ${name} ${option}${flag}\`.`
}

/**
 * How to get out of `problem` of profile `name`: where a credential comes from instead, the
 * `pulse config` command that removes or sets the key, else fixing the file. A name that is no
 * valid name is not repeated: the commands say `<profile>`.
 */
export function problemHint(
  name: string,
  problem: Problem,
  project: boolean,
  defaultOf?: ProfileOrigin["defaultOf"],
): string {
  const flag = project ? " --project" : ""
  const shown = PROFILE_NAME.test(name) ? name : "<profile>"
  return (
    CODE_HINTS[problem.code]?.(shown, flag, useHint(defaultOf)) ??
    keyHint(shown, problem, flag) ??
    `Fix the profile in the file, or change it with \`pulse config set ${shown} <options>${flag}\`.`
  )
}

/** A command uses profile `name`, which the file holds but the CLI cannot use. */
export function refusedProfileError(
  name: string,
  problems: readonly Problem[],
  origin: ProfileOrigin,
): PulseCliError {
  const shown = PROFILE_NAME.test(name) ? `Profile "${name}"` : "The profile"
  const [first] = problems
  return configError(
    `${shown} of ${fileOf(origin)} cannot be used: ${describeProblems(problems)}`,
    first === undefined
      ? undefined
      : problemHint(name, first, origin.project !== undefined, origin.defaultOf),
  )
}

/**
 * An edit would write a file whose profile `name` holds a key or its name twice: JSON keeps only
 * the last one, so writing the file would settle it without a word (`settledTwice`).
 */
export function settledTwiceError(
  name: string,
  problem: Problem,
  origin: ProfileOrigin,
): PulseCliError {
  const file = fileOf(origin)
  const shown = PROFILE_NAME.test(name) ? `profile "${name}"` : "a profile"
  return configError(
    `${file.charAt(0).toUpperCase()}${file.slice(1)} is left as it is, since ${shown} cannot be written back as the file holds it: ${describeProblem(problem)}`,
    "pulse config writes the whole file and would keep only the last of the two without a word: fix the file in an editor first, then run the command again.",
  )
}

/** A command needs the default profile, and the defaultProfile of a file cannot give one. */
export function defaultProfileError(problem: Problem, project?: string): PulseCliError {
  const use =
    project === undefined
      ? "`pulse config use <profile>`"
      : "`pulse config use <profile> --project`"
  return configError(
    `The default profile of ${fileOf({ project })} cannot be used: ${describeProblem(problem)}`,
    `Choose a profile with --profile or ${ENV.profile}, make one the default with ${use}, or give --url, which selects no profile.`,
  )
}

/**
 * What `config list` and `config show` report on stderr besides the profiles: the notes on each
 * file's root (an unknown key, a defaultProfile that gives no default) and the profiles whose name
 * is no valid name (never shown, so they are not listed). `userPath` is the user's config file.
 */
export function fileNotices(config: LoadedConfig | undefined, userPath: string): string[] {
  if (config === undefined) return []
  const project = config.project
  const fromProject = project?.profiles ?? []
  const fileNamed = (fromTheProject: boolean) =>
    fromTheProject && project !== undefined
      ? `the project file ${project.source.path}`
      : `the config file ${userPath}`
  const notes = [
    ...(config.notes ?? []).map((note) => `${fileNamed(false)}: ${describeProblem(note)}`),
    ...(project?.notes ?? []).map((note) => `${fileNamed(true)}: ${describeProblem(note)}`),
  ]
  const unnamed = Object.entries(config.refused ?? {})
    .filter(([name]) => !PROFILE_NAME.test(name))
    .map(
      ([name, problems]) =>
        `${fileNamed(fromProject.includes(name))}: ${describeProblems(problems)}`,
    )
  return [...notes, ...unnamed].map((notice) => `Notice: ${notice}`)
}
