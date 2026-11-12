/**
 * A `--url` flag beside a `--profile` flag replaces only the profile's URL (resolve.ts), so the
 * profile's credentials would go to the flag's URL. A profile of the user's own config file (or of
 * the one `--config` or PULSE_CLI_CONFIG names) that holds credentials goes only to the origin
 * (scheme, host, port) of its own `url`: a `--url` of another origin fails (CONFIG, owner decision
 * 2026-11-12). A project file, or an editor's command copied from one, names such a URL, and it
 * decides where the environment's credentials and its own profiles' logins go, never where a
 * profile of the user's sends its own. Not refused: a profile of the project file (it chose its
 * URL itself), a profile without credentials, the same origin, and PULSE_CLI_URL (it stays per
 * value). Decided from the flags, the environment and the stored profile alone, so it fails
 * before any request, login lookup or variable read. Pure.
 */

import { isSecretHeader } from "@miragon/pulse-profile"
import type { PulseCliError } from "../errors.js"
import { configError } from "./config-error.js"
import { type Env, nonEmpty } from "./pick.js"
import { fileOf } from "./profile-problems.js"
import {
  BASIC_AUTH_KEYS,
  BEARER_AUTH_KEYS,
  type ConfigFlags,
  ENV,
  OAUTH_AUTH_KEYS,
  type Profile,
  type ProfileAuth,
  type SelectedProfile,
} from "./types.js"

/** A selected profile: its name, the profile, and where it comes from. */
type Chosen = Extract<SelectedProfile, { name: string }>

/** True when the auth object stores one of `keys`. */
function stores(auth: ProfileAuth | undefined, keys: readonly (keyof ProfileAuth)[]): boolean {
  return auth !== undefined && keys.some((key) => auth[key] !== undefined)
}

/**
 * OAuth, whose cached login is the profile's own (`LoginKey.origin` is its file's): a stored OAuth
 * setting or auth.type, which counts even when `--auth` or PULSE_CLI_AUTH switch it off, or OAuth
 * selected for the profile by `--auth` or PULSE_CLI_AUTH.
 */
function holdsOAuth(flags: ConfigFlags, env: Env, auth: ProfileAuth | undefined): boolean {
  if (auth?.type === "oauth" || stores(auth, OAUTH_AUTH_KEYS)) return true
  return (nonEmpty(flags.auth) ?? nonEmpty(env[ENV.auth])) === "oauth"
}

/**
 * The credentials a profile holds, as the error names them: its secret headers (`isSecretHeader`
 * of the profile format, which refuses them in a project file; output masks the same names), its
 * Basic auth (username, password or its variable), an OAuth login and a bearer token (the token or
 * its variable). A type alone (`basic`, `bearer`) takes its credentials from the environment. A
 * header by another name is no credential here, so its value goes to the `--url` like any header.
 */
function credentialsOf(profile: Profile, flags: ConfigFlags, env: Env): string[] {
  const { auth } = profile
  const headers = Object.keys(profile.headers ?? {}).filter(isSecretHeader)
  const noun = headers.length === 1 ? "header" : "headers"
  return [
    ...(headers.length === 0 ? [] : [`${noun} ${headers.join(", ")}`]),
    ...(stores(auth, BASIC_AUTH_KEYS) ? ["Basic auth"] : []),
    ...(holdsOAuth(flags, env, auth) ? ["an OAuth login"] : []),
    ...(stores(auth, BEARER_AUTH_KEYS) ? ["a bearer token"] : []),
  ]
}

/** The origin of a URL the profile format took (`http://Host:80` is `http://host`), else none. */
function originOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  try {
    return new URL(url.trim()).origin
  } catch {
    return undefined
  }
}

/**
 * The CONFIG error for a `--url` (`url`, validated) beside `--profile` whose origin is not the one
 * of the selected profile's own URL, when the profile comes from the user's config file and holds
 * credentials; undefined when the command may go on. A profile without a URL has no origin.
 */
export function foreignUrlError(
  chosen: Chosen,
  url: string,
  flags: ConfigFlags,
  env: Env,
): PulseCliError | undefined {
  if (chosen.project !== undefined) return undefined
  const target = new URL(url).origin
  const own = originOf(chosen.profile.url)
  if (own === target) return undefined
  const credentials = credentialsOf(chosen.profile, flags, env)
  if (credentials.length === 0) return undefined
  const { name } = chosen
  const holds = `holds credentials (${credentials.join("; ")})`
  const point = `point the profile at that engine with \`pulse config set ${name} --url <url>\``
  return configError(
    `Profile "${name}" of ${fileOf({ configFile: chosen.configFile })} ${holds} ${own === undefined ? "but no URL" : `for ${own}`}; pulse does not send them to ${target}, the origin --url names`,
    own === undefined
      ? `${point.charAt(0).toUpperCase()}${point.slice(1)}.`
      : `Drop --url to use the profile with its own URL, or ${point}.`,
  )
}
