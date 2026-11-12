/** A `--url` without `--profile` selects no profile (resolve.ts): what it leaves out. */

import { type Env, nonEmpty } from "./pick.js"
import { type AuthConfig, type ConfigFlags, ENV, type LoadedConfig } from "./types.js"

export function urlWithoutProfile(flags: ConfigFlags): boolean {
  return nonEmpty(flags.url) !== undefined && nonEmpty(flags.profile) === undefined
}

const URL_WITHOUT_PROFILE = "--url without --profile selects no profile"

/** The default profile a `--url` leaves out, broken or not, by the file that names it. */
function defaultLeftOut(file: LoadedConfig | undefined): string | undefined {
  if (file === undefined) return undefined
  const broken = file.defaultProblem
  if (broken === undefined && nonEmpty(file.defaultProfile) === undefined) return undefined
  const fromProject = file.project?.defaultProfile === true ? file.project.source.path : undefined
  const project = broken === undefined ? fromProject : broken.project
  const where = project === undefined ? "the config file" : `the project file ${project}`
  return `the default profile of ${where}`
}

/** Why no profile applies (`config show`), also why no credentials went (a 401's hint). */
export function withoutProfile(
  auth: AuthConfig,
  flags: ConfigFlags,
  env: Env,
  file: LoadedConfig | undefined,
): { readonly auth: AuthConfig; readonly noProfile?: string } {
  if (!urlWithoutProfile(flags)) return { auth }
  const left = nonEmpty(env[ENV.profile]) === undefined ? defaultLeftOut(file) : ENV.profile
  if (left === undefined) return { auth, noProfile: URL_WITHOUT_PROFILE }
  const noProfile = `${URL_WITHOUT_PROFILE}, so ${left} does not apply`
  if (auth.type !== "none" || auth.off !== undefined) return { auth, noProfile }
  return { auth: { ...auth, off: noProfile }, noProfile }
}
