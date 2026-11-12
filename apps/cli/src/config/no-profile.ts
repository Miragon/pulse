/** A URL without `--profile` selects no profile (resolve.ts): what it leaves out. */

import { PROFILE_NAME } from "@miragon/pulse-profile"
import { type Env, nonEmpty } from "./pick.js"
import { type AuthConfig, type ConfigFlags, ENV, type LoadedConfig } from "./types.js"

/** What gives a URL that selects no profile: `--url`, else PULSE_CLI_URL; none beside `--profile`. */
export function urlWithoutProfile(flags: ConfigFlags, env: Env): string | undefined {
  if (nonEmpty(flags.profile) !== undefined) return undefined
  if (nonEmpty(flags.url) !== undefined) return "--url"
  return nonEmpty(env[ENV.url]) === undefined ? undefined : ENV.url
}

/** The default profile a URL leaves out, broken or not, by the file that names it. */
function defaultLeftOut(file: LoadedConfig | undefined): string | undefined {
  if (file === undefined) return undefined
  const broken = file.defaultProblem
  if (broken === undefined && nonEmpty(file.defaultProfile) === undefined) return undefined
  const fromProject = file.project?.defaultProfile === true ? file.project.source.path : undefined
  const project = broken === undefined ? fromProject : broken.project
  const where = project === undefined ? "the config file" : `the project file ${project}`
  return `the default profile of ${where}`
}

/** The profile a URL without `--profile` leaves out: PULSE_CLI_PROFILE, else a default profile. */
function leftOut(env: Env, file: LoadedConfig | undefined): string | undefined {
  return nonEmpty(env[ENV.profile]) === undefined ? defaultLeftOut(file) : ENV.profile
}

/** Why a URL (`by`) selects no profile, and the profile it leaves out, if any. */
function reasonOf(by: string, env: Env, file: LoadedConfig | undefined): string {
  const selectsNone = `${by} without --profile selects no profile`
  const left = leftOut(env, file)
  return left === undefined ? selectsNone : `${selectsNone}, so ${left} does not apply`
}

/**
 * Why no profile applies (`config show`, the hints of the auth commands): what gives the URL and
 * the profile it leaves out, if any.
 */
function noProfileReason(
  flags: ConfigFlags,
  env: Env,
  file: LoadedConfig | undefined,
): string | undefined {
  const by = urlWithoutProfile(flags, env)
  return by === undefined ? undefined : reasonOf(by, env, file)
}

/** `noProfileReason`, which a 401's hint also names when a profile was left out (`off`). */
export function withoutProfile(
  auth: AuthConfig,
  flags: ConfigFlags,
  env: Env,
  file: LoadedConfig | undefined,
): { readonly auth: AuthConfig; readonly noProfile?: string } {
  const noProfile = noProfileReason(flags, env, file)
  if (noProfile === undefined) return { auth }
  if (leftOut(env, file) === undefined) return { auth, noProfile }
  if (auth.type !== "none" || auth.off !== undefined) return { auth, noProfile }
  return { auth: { ...auth, off: noProfile }, noProfile }
}

/**
 * How a profile applies again beside a URL that selects none (`by`, what gives it: `--url` or
 * PULSE_CLI_URL): without the URL, each one that is set (`--url`, a non-empty PULSE_CLI_URL). Never
 * `--profile` beside the URL, which would take the profile's credentials there.
 */
export function withoutTheUrl(by: string, env: Env): string {
  if (by !== "--url") return `unset ${ENV.url}`
  return nonEmpty(env[ENV.url]) === undefined ? "drop --url" : `drop --url and unset ${ENV.url}`
}

/** Why no profile applies (`noProfileReason`) and how to leave that URL out (the auth hints). */
export function noProfileAdvice(
  flags: ConfigFlags,
  env: Env,
  file: LoadedConfig | undefined,
): { readonly reason: string; readonly withoutUrl: string } | undefined {
  const by = urlWithoutProfile(flags, env)
  if (by === undefined) return undefined
  return { reason: reasonOf(by, env, file), withoutUrl: withoutTheUrl(by, env) }
}

/**
 * The warning a command writes on stderr, once, when a URL without `--profile` leaves out the
 * PULSE_CLI_PROFILE the user set (not a defaultProfile), and the advice to drop that URL. It names
 * the variable's value only as a profile name, so nothing else of the environment reaches the
 * terminal.
 */
export function profileNotice(flags: ConfigFlags, env: Env): string | undefined {
  const by = urlWithoutProfile(flags, env)
  const name = nonEmpty(env[ENV.profile])
  if (by === undefined || name === undefined) return undefined
  const variable = PROFILE_NAME.test(name) ? `${ENV.profile}=${name}` : ENV.profile
  return `Warning: ${variable} does not apply beside ${by}; ${withoutTheUrl(by, env)} to use it.\n`
}
