/**
 * Which profiles share an OAuth login: the OAuth profiles of one origin (the user's
 * config file, a config file named by `--config` / PULSE_CLI_CONFIG, or the repository of a project
 * file) that store the same issuer or explicit token endpoint, client id, audience and scopes. A
 * login made for the profiles of one origin never serves those of another, also not a profile of
 * the same name: a project file decides where its profiles send tokens. Pure.
 */

import { posix, win32 } from "node:path"
import {
  type ConfigFile,
  DEFAULT_OAUTH_SCOPES,
  type LoadedConfig,
  type LoginKey,
  type ProfileAuth,
  type SelectedProfile,
} from "./types.js"

/** A path as origins compare it: absolute, normalized, on win32 without case. */
export function originPath(path: string, cwd: string, platform: string): string {
  const resolved = (platform === "win32" ? win32 : posix).resolve(cwd, path)
  return platform === "win32" ? resolved.toLowerCase() : resolved
}

/** `config:<path>`: the origin of the profiles of a config file. */
export function configOrigin(path: string, cwd: string, platform: string): string {
  return `config:${originPath(path, cwd, platform)}`
}

/**
 * The login key of profile `name` of `origin` with the stored auth settings `stored`. A profile
 * that stores no `type: "oauth"` gets OAuth from the environment and a login of its own.
 */
export function loginKeyOf(
  origin: string,
  stored: ProfileAuth | undefined,
  name?: string,
): LoginKey {
  const auth: ProfileAuth = stored ?? {}
  const explicit = auth.authorizationEndpoint !== undefined
  return {
    origin,
    ...(auth.type === "oauth" || name === undefined ? {} : { profile: name }),
    issuer: auth.issuer ?? null,
    tokenEndpoint: explicit ? (auth.tokenEndpoint ?? null) : null,
    clientId: auth.clientId ?? null,
    audience: auth.audience ?? null,
    scopes: [...new Set(auth.scopes ?? DEFAULT_OAUTH_SCOPES)].sort(),
  }
}

/**
 * The login key of a selected profile. Its origin comes from the file it was read from
 * (`loadConfig`); a configuration not read from a file (tests) has the empty origin.
 */
export function selectedLoginKey(selected: Extract<SelectedProfile, { name: string }>): LoginKey {
  return loginKeyOf(selected.origin ?? "", selected.profile.auth, selected.name)
}

export function sameLoginKey(left: LoginKey, right: LoginKey): boolean {
  return (
    left.origin === right.origin &&
    left.profile === right.profile &&
    left.issuer === right.issuer &&
    left.tokenEndpoint === right.tokenEndpoint &&
    left.clientId === right.clientId &&
    left.audience === right.audience &&
    left.scopes.join(" ") === right.scopes.join(" ")
  )
}

/** The origin of profile `name` of the loaded configuration: its project file's or the file's. */
export function originOf(file: LoadedConfig, name: string): string | undefined {
  return file.project?.profiles.includes(name) === true ? file.project.source.origin : file.origin
}

/**
 * The OAuth profiles of `file` that use the login of `key`, in file order. A config file read
 * on its own is one origin: pass it as `{ ...file, origin }`.
 */
export function loginProfiles(file: LoadedConfig | undefined, key: LoginKey): string[] {
  const profiles: ConfigFile["profiles"] = file?.profiles ?? {}
  return Object.entries(profiles)
    .filter(([name, profile]) => {
      if (file === undefined || profile.auth?.type !== "oauth") return false
      const origin = originOf(file, name)
      return origin !== undefined && sameLoginKey(loginKeyOf(origin, profile.auth), key)
    })
    .map(([name]) => name)
}
