/** What the `pulse-cli config` commands print: profiles and the effective configuration. Pure. */

import type { ConfigView } from "../../config/edit.js"
import type { Env } from "../../config/pick.js"
import { findProfile } from "../../config/resolve.js"
import type { ConfigFile, ProfileAuth, Source } from "../../config/types.js"
import { mayBeSecret } from "../../config/variable.js"
import { MASK, maskHeaders } from "../../output/secrets.js"

/** The keys that name the variable of a secret. */
const VARIABLE_KEYS = ["passwordEnv", "clientSecretEnv", "tokenEnv"] as const

/**
 * The stored auth object with the password, the client secret and the token masked, and the name
 * of a secret's variable when it may be the secret itself (`mayBeSecret`: a hand-edited file).
 */
function maskedAuth(auth: ProfileAuth, env: Env): ProfileAuth {
  const secretNames = VARIABLE_KEYS.filter((key) => {
    const name = auth[key]
    return name !== undefined && mayBeSecret(name, env)
  })
  return {
    ...auth,
    ...(auth.password === undefined ? {} : { password: MASK }),
    ...(auth.clientSecret === undefined ? {} : { clientSecret: MASK }),
    ...(auth.token === undefined ? {} : { token: MASK }),
    ...Object.fromEntries(secretNames.map((key) => [key, MASK])),
  }
}

/**
 * A stored profile with its name and default flag; header values, the password, the client
 * secret and the bearer token masked, as well as a variable name that may be a secret (`env` is
 * the environment of the command).
 */
export function profileView(file: ConfigFile, name: string, env: Env): Record<string, unknown> {
  const profile = findProfile(file, name) ?? {}
  const headers =
    profile.headers === undefined ? {} : { headers: maskHeaders(profile.headers, false) }
  const auth = profile.auth === undefined ? {} : { auth: maskedAuth(profile.auth, env) }
  return { name, default: file.defaultProfile === name, ...profile, ...headers, ...auth }
}

function masked<T>(entry: { value: T | null; source: Source }, show: boolean) {
  return { ...entry, value: show || entry.value === null ? entry.value : MASK }
}

/**
 * The `config show` view with header values, the password, the client secret and the bearer
 * token masked unless `showSecrets`.
 */
export function maskedView(view: ConfigView, showSecrets: boolean): ConfigView {
  const { headers, password, clientSecret, token } = view.values
  return {
    ...view,
    values: {
      ...view.values,
      password: masked(password, showSecrets),
      ...(clientSecret === undefined ? {} : { clientSecret: masked(clientSecret, showSecrets) }),
      ...(token === undefined
        ? {}
        : { token: { ...token, value: showSecrets ? token.value : MASK } }),
      headers: { ...headers, value: maskHeaders(headers.value, showSecrets) },
    },
  }
}

/** A VALUE cell: lists (scopes) space-joined; an unused token says why it is not used. */
function cell(entry: { readonly value: unknown; readonly unused?: string }): unknown {
  if (entry.unused !== undefined) return `${String(entry.value)} (unused: ${entry.unused})`
  return Array.isArray(entry.value) ? entry.value.join(" ") : entry.value
}

/** Rows of the `config show` table: KEY VALUE SOURCE. */
export function showRows(view: ConfigView): Record<string, unknown>[] {
  return Object.entries(view.values).map(([key, entry]) => ({
    KEY: key,
    VALUE: cell(entry),
    SOURCE: entry.source,
  }))
}

/**
 * Lines in front of the `config show` table: the config file, the project file in effect and
 * the profile with the file it comes from, when that is the project file.
 */
export function showHeader(view: ConfigView): string {
  const project = view.projectFile === null ? "" : `Project file: ${view.projectFile}\n`
  const from =
    view.profileFile !== null && view.profileFile === view.projectFile
      ? ` (from the project file)`
      : ""
  return `Config file: ${view.configFile}\n${project}Profile: ${view.profile ?? "(none)"}${from}\n\n`
}
