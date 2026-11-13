/**
 * What a reader can serve, as data, and which profiles it therefore refuses. A key that would
 * change what is sent or what is allowed is applied or refuses the profile, never ignored: a
 * reader that cannot apply `headers` lists it in `refusedKeys`.
 */

import {
  type AuthType,
  DEFAULT_FLAVOR,
  type Dialect,
  FLAVORS,
  type Problem,
  type Profile,
  PROFILE_KEYS,
  type ProfileKey,
} from "./types.js"

/** What a reader (the CLI, Pulse for VS Code, the MCP server) can serve. */
export interface Surface {
  /** The API dialects it speaks. */
  readonly dialects: readonly Dialect[]
  /** The auth types it can authenticate with. */
  readonly authTypes: readonly AuthType[]
  /** It needs `url` from the profile (no flag or variable gives one). */
  readonly urlRequired: boolean
  /** It reaches only the default process engine, so `engine` must be absent or `default`. */
  readonly defaultEngineOnly: boolean
  /** Keys it cannot apply: a profile that sets one is refused. */
  readonly refusedKeys: readonly ProfileKey[]
}

/** The dialect a profile speaks: its flavor's, DEFAULT_FLAVOR's without one. */
export function dialectOf(profile: Profile): Dialect {
  return FLAVORS[profile.flavor ?? DEFAULT_FLAVOR]
}

/** The auth type a profile uses: its own, else Basic auth with a username, else none. */
export function authTypeOf(profile: Profile): AuthType {
  const auth = profile.auth
  return auth?.type ?? (auth?.username === undefined ? "none" : "basic")
}

/** Why `surface` cannot serve the usable `profile`; empty when it can. */
export function refusalsOn(profile: Profile, surface: Surface): readonly Problem[] {
  const refused: Problem[] = []
  if (!surface.dialects.includes(dialectOf(profile))) {
    refused.push({ code: "dialect-not-served", key: "flavor" })
  }
  if (!surface.authTypes.includes(authTypeOf(profile))) {
    refused.push({ code: "auth-type-not-served", key: "auth.type" })
  }
  if (surface.urlRequired && profile.url === undefined) {
    refused.push({ code: "url-missing", key: "url" })
  }
  const { engine } = profile
  if (surface.defaultEngineOnly && engine !== undefined && engine !== "default") {
    refused.push({ code: "process-engine-not-served", key: "engine" })
  }
  const keys = PROFILE_KEYS.filter(
    (key) => surface.refusedKeys.includes(key) && profile[key] !== undefined,
  )
  return [...refused, ...keys.map((key): Problem => ({ code: "key-not-served", key }))]
}
