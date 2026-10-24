/**
 * The profiles that share the OAuth login of `pulse-cli auth login|status|logout`:
 * the OAuth profiles of the files in effect with the same origin and stored settings
 * (`loginProfiles`), and what the commands say about them. `auth login` lists the other profiles
 * with their URLs, so the person sees where the login is sent; `auth logout` names those that
 * lose it. In a repository, project files elsewhere and other worktrees may use it, too.
 */

import { loginFileName } from "../../auth/oauth/cache.js"
import type { OAuthDeps } from "../../auth/oauth/types.js"
import { loginProfiles, selectedLoginKey } from "../../config/login-key.js"
import { findProfile } from "../../config/resolve.js"
import {
  DEFAULT_URL,
  type LoadedConfig,
  type LoginKey,
  type SelectedProfile,
} from "../../config/types.js"

/**
 * The profiles that use the login of `key`, in file order; `profile` first when it is not among
 * them (OAuth selected by the environment for a profile that stores none). None without a profile.
 */
export function sharingProfiles(
  file: LoadedConfig | undefined,
  key: LoginKey | undefined,
  profile: string | undefined,
): string[] {
  if (key === undefined || profile === undefined) return []
  const profiles = loginProfiles(file, key)
  return profiles.includes(profile) ? profiles : [profile, ...profiles]
}

function others(profiles: readonly string[], profile: string | undefined): string[] {
  return profiles.filter((name) => name !== profile)
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"`. */
export function quotedNames(names: readonly string[]): string {
  const list = names.map((name) => `"${name}"`)
  return list.length === 1
    ? (list[0] ?? "")
    : `${list.slice(0, -1).join(", ")} and ${list.at(-1) ?? ""}`
}

/** The lines on stderr after `auth login`: the other profiles the login serves and their URLs. */
export function sharedLoginLines(
  file: LoadedConfig | undefined,
  profiles: readonly string[],
  profile: string | undefined,
): string[] {
  const rest = others(profiles, profile)
  if (rest.length === 0) return []
  const width = Math.max(...rest.map((name) => name.length))
  const count = rest.length === 1 ? "another profile" : `${String(rest.length)} other profiles`
  return [
    `The login also serves ${count} with the same issuer, client, audience and scopes:`,
    ...rest.map(
      (name) => `  ${name.padEnd(width)}  ${findProfile(file, name)?.url ?? DEFAULT_URL}`,
    ),
  ]
}

/** The note on stderr after `auth logout` when other profiles lose the login, too. */
export function sharedLogoutNote(
  profiles: readonly string[],
  profile: string | undefined,
): string | undefined {
  const rest = others(profiles, profile)
  if (rest.length === 0) return undefined
  const verb = rest.length === 1 ? "needs" : "need"
  return `Note: the login was shared; profile${rest.length === 1 ? "" : "s"} ${quotedNames(rest)} ${verb} a new login, too.`
}

/**
 * The cache file of a selected profile's login and the profiles that share it, from its stored
 * settings: `auth logout` finds the login also when the settings no longer resolve.
 */
export async function storedLogin(
  file: LoadedConfig | undefined,
  selected: Extract<SelectedProfile, { name: string }>,
  deps: Pick<OAuthDeps, "tokenPath">,
) {
  const key = selectedLoginKey(selected)
  return {
    tokenCache: deps.tokenPath(await loginFileName(key)),
    profiles: sharingProfiles(file, key, selected.name),
  }
}
