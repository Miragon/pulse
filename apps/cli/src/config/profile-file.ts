/**
 * The CLI's reading of a profile file, the user's config file and a project file alike: the
 * verdicts of @miragon/pulse-profile mapped onto the config types. Only text that gives no profiles
 * fails the file; a profile the format or the CLI refuses stays in the file as it stands (an edit
 * keeps it) and carries its problems, so a command fails only when it uses it. A file read under
 * the policy `none` (a project file) keeps no key of a secret or of its variable at all, so no
 * reader can reach a variable a repository chose, not even one that forgets `refused`. The
 * wording is the CLI's (profile-problems.ts).
 */

import {
  type CredentialPolicy,
  parseProfileFile,
  type Problem,
  PROFILE_NAME,
  type ProfileVerdict,
  refusalsOn,
  ROOT_KEYS,
  SECRET_KEYS,
  type Surface,
  VARIABLE_KEYS,
} from "@miragon/pulse-profile"
import { isRecord } from "../util.js"
import { AUTH_TYPES, type ConfigFile, type Profile } from "./types.js"

/**
 * What the CLI serves of a profile: the Camunda 7 REST dialect, its four auth types (not the MCP
 * server's passthrough), a URL from the profile or else from a flag, the environment or the
 * default, any process engine, and every key.
 */
const CLI_SURFACE: Surface = {
  dialects: ["c7"],
  authTypes: AUTH_TYPES,
  urlRequired: false,
  defaultEngineOnly: false,
  refusedKeys: [],
}

const BYTE_ORDER_MARK = "﻿"

/** A file that gives profiles, or why it gives none. */
export type ReadFile = { readonly file: ConfigFile } | { readonly problem: Problem }

/**
 * The key of each verdict in the parsed `profiles`: its name, or for a name that is no valid
 * profile name (never shown, so the verdict has none) the next such key. JSON.parse keeps those
 * keys in the order of the text, as the verdicts are, since none of them is an array index.
 */
function keysOf(stored: Readonly<Record<string, unknown>>, verdicts: readonly ProfileVerdict[]) {
  const unnamed = Object.keys(stored).filter((key) => !PROFILE_NAME.test(key))
  let next = 0
  return verdicts.map((verdict) => {
    if (verdict.name !== undefined) return verdict.name
    next += 1
    return unnamed[next - 1]
  })
}

/** Why the CLI cannot use the profile of `verdict`: the format's problems, else the CLI's. */
function problemsOf(verdict: ProfileVerdict): readonly Problem[] {
  return verdict.profile === undefined ? verdict.problems : refusalsOn(verdict.profile, CLI_SURFACE)
}

function refusedOf(stored: Readonly<Record<string, unknown>>, verdicts: readonly ProfileVerdict[]) {
  const keys = keysOf(stored, verdicts)
  const refused = verdicts.flatMap((verdict, index) => {
    const key = keys[index]
    const problems = problemsOf(verdict)
    return key === undefined || problems.length === 0 ? [] : [[key, problems] as const]
  })
  return refused.length === 0 ? {} : { refused: Object.fromEntries(refused) }
}

function unknownOf(root: Readonly<Record<string, unknown>>) {
  const known: readonly string[] = ROOT_KEYS
  const unknown = Object.entries(root).filter(([key]) => !known.includes(key))
  return unknown.length === 0 ? {} : { unknown: Object.fromEntries(unknown) }
}

/** The keys of a secret and of the variable that holds one, which a shared file never names. */
const CREDENTIAL_KEYS: ReadonlySet<string> = new Set([...SECRET_KEYS, ...VARIABLE_KEYS])

/** A profile of a file read under the policy `none`, without the keys of a secret or its variable. */
function withoutCredentials(profile: unknown): unknown {
  if (!isRecord(profile) || !isRecord(profile.auth)) return profile
  const auth = Object.entries(profile.auth).filter(([key]) => !CREDENTIAL_KEYS.has(key))
  return { ...profile, auth: Object.fromEntries(auth) }
}

/** The profiles as the CLI keeps them: as the file holds them, under `none` without credentials. */
function keptProfiles(stored: Readonly<Record<string, unknown>>, policy: CredentialPolicy) {
  if (policy !== "none") return stored
  return Object.fromEntries(
    Object.entries(stored).map(([key, profile]) => [key, withoutCredentials(profile)]),
  )
}

/**
 * Why a command cannot use the profile stored under `name`, or undefined when it can. Own keys
 * only: a valid name such as `toString` or `constructor` never reads Object.prototype.
 */
export function refusalOf(file: ConfigFile, name: string): readonly Problem[] | undefined {
  const { refused } = file
  return refused !== undefined && Object.hasOwn(refused, name) ? refused[name] : undefined
}

/**
 * Reads the text of a profile file under the credential policy of where it comes from: the
 * user's config file `env-or-literal`, a project file `none` (it names neither a secret nor a
 * variable, so no resolver ever reads a variable a repository chose).
 */
export function readProfileFile(text: string, policy: CredentialPolicy): ReadFile {
  const parsed = parseProfileFile(text, { credentials: policy })
  if (parsed.problem !== undefined) return { problem: parsed.problem }
  const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text
  const root = JSON.parse(source) as Readonly<Record<string, unknown>>
  const stored = isRecord(root.profiles) ? root.profiles : {}
  const { $schema, defaultProfile } = root
  return {
    file: {
      ...(typeof $schema === "string" ? { $schema } : {}),
      ...(typeof defaultProfile === "string" ? { defaultProfile } : {}),
      profiles: keptProfiles(stored, policy) as Readonly<Record<string, Profile>>,
      ...refusedOf(stored, parsed.profiles),
      ...(parsed.notes.length === 0 ? {} : { notes: parsed.notes }),
      ...unknownOf(root),
    },
  }
}
