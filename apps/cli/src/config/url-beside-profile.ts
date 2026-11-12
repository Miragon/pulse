/**
 * A `--url` flag beside a `--profile` flag replaces only the profile's URL (resolve.ts), so the
 * profile's headers and credentials would go to the flag's URL. A profile of the user's own config
 * file (or of the one `--config` or PULSE_CLI_CONFIG names) that holds a header or a credential
 * goes only to the origin (scheme, host, port) of its own `url`: a `--url` of another origin fails
 * (CONFIG, owner decisions 2026-11-12). A project file, or an editor's command copied from one,
 * names such a URL, and it decides where the environment's credentials and its own profiles'
 * logins go, never where a profile of the user's sends what it holds. Not refused: a profile of the
 * project file (it chose its URL itself), a profile without headers or credentials, the same
 * origin, and PULSE_CLI_URL (it stays per value). Decided from the flags, the environment and the
 * stored profile alone, so it fails before any request, login lookup or variable read. Pure.
 */

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
 * What a profile holds that it sends, as the error names it: every header it stores, whatever its
 * name (owner decision 2026-11-12: a header a profile sends is the profile's, and a repository
 * must not route it; an `-H` or PULSE_CLI_HEADERS is the user's own per run and does not count),
 * its Basic auth (username, password or its variable), an OAuth login and a bearer token (the
 * token or its variable). A type alone (`basic`, `bearer`) takes its credentials from the
 * environment. `count` is how many things that is, a header each.
 */
function heldBy(
  profile: Profile,
  flags: ConfigFlags,
  env: Env,
): { words: string[]; count: number } {
  const { auth } = profile
  const headers = Object.keys(profile.headers ?? {})
  const kinds = [
    ...(stores(auth, BASIC_AUTH_KEYS) ? ["Basic auth"] : []),
    ...(holdsOAuth(flags, env, auth) ? ["an OAuth login"] : []),
    ...(stores(auth, BEARER_AUTH_KEYS) ? ["a bearer token"] : []),
  ]
  const named = headers.length === 1 ? "a header" : "headers"
  return {
    words: [...(headers.length === 0 ? [] : [`${named} (${headers.join(", ")})`]), ...kinds],
    count: headers.length + kinds.length,
  }
}

/** `a`, `a and b`, `a, b and c`. */
function listed(words: readonly string[]): string {
  return [words.slice(0, -1).join(", "), ...words.slice(-1)].filter(Boolean).join(" and ")
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
 * a header or a credential; undefined when the command may go on. A profile without a URL has no
 * origin. The error names what the profile holds, never a value.
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
  const held = heldBy(chosen.profile, flags, env)
  if (held.count === 0) return undefined
  const { name } = chosen
  const holds = `holds ${listed(held.words)} ${own === undefined ? "but no URL" : `for ${own}`}`
  const point = `point the profile at that engine with \`pulse config set ${name} --url <url>\``
  return configError(
    `Profile "${name}" of ${fileOf({ configFile: chosen.configFile })} ${holds}; pulse does not send ${held.count === 1 ? "it" : "them"} to ${target}, the origin --url names`,
    own === undefined
      ? `${point.charAt(0).toUpperCase()}${point.slice(1)}.`
      : `Drop --url to use the profile with its own URL, or ${point}.`,
  )
}
