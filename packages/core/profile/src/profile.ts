/**
 * One profile: its keys, the value each takes, and the profile as a reader gets it once nothing
 * refuses it.
 */

import { authProblems } from "./auth.js"
import { isHeaderName, isHeaderValue, isSecretHeader } from "./headers.js"
import { type Members, objectMembers } from "./json-text.js"
import { keyed } from "./keys.js"
import { ENVIRONMENT_ID, isNonEmptyString, isRecord } from "./syntax.js"
import {
  type CredentialPolicy,
  FLAVORS,
  OUTPUT_FORMATS,
  type Problem,
  type ProblemCode,
  type Profile,
  PROFILE_KEYS,
  type ProfileKey,
} from "./types.js"
import { normalizeCockpitUrl, normalizeUrl, urlProblem } from "./url.js"

/** The longest delay a Node.js timer holds (2^31 - 1 ms, about 24.8 days). */
export const MAX_TIMEOUT_MS = 2_147_483_647

/** True for a process engine name: not blank, not "." or ".." (they would leave /engine/{name}). */
export function isEngineName(value: unknown): boolean {
  if (typeof value !== "string") return false
  const trimmed = value.trim()
  return trimmed !== "" && trimmed !== "." && trimmed !== ".."
}

/** True for a request timeout: a whole number of milliseconds, 1 to MAX_TIMEOUT_MS. */
export function isTimeout(value: unknown): boolean {
  return (
    typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS
  )
}

function linkCode(value: unknown, normalize: (url: string) => string): ProblemCode | undefined {
  return isNonEmptyString(value) ? urlProblem(normalize(value)) : "invalid"
}

/** The check of each plain value; auth and headers are objects with checks of their own. */
const VALUE_CHECKS: Readonly<
  Record<Exclude<ProfileKey, "auth" | "headers">, (value: unknown) => ProblemCode | undefined>
> = {
  url: (value) => linkCode(value, normalizeUrl),
  cockpitUrl: (value) => linkCode(value, normalizeCockpitUrl),
  engine: (value) => (isEngineName(value) ? undefined : "invalid"),
  flavor: (value) => {
    if (typeof value !== "string") return "invalid"
    return Object.hasOwn(FLAVORS, value) ? undefined : "flavor-unknown"
  },
  environment: (value) =>
    typeof value === "string" && ENVIRONMENT_ID.test(value) ? undefined : "invalid",
  output: (value) => (OUTPUT_FORMATS.some((format) => format === value) ? undefined : "invalid"),
  timeout: (value) => (isTimeout(value) ? undefined : "invalid"),
  readOnly: (value) => (typeof value === "boolean" ? undefined : "invalid"),
}

function isHeaderMap(value: unknown): value is Readonly<Record<string, unknown>> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([name, entry]) => isHeaderName(name) && typeof entry === "string" && isHeaderValue(entry),
    )
  )
}

/** A secret header, named when its name looks like a key, else as `headers`. */
function secretHeader(name: string): Problem {
  const named = keyed("secret-header", "headers", name)
  return named.key === undefined ? { code: "secret-header", key: "headers" } : named
}

/**
 * The header names `names` lists again in another spelling: HTTP compares them ignoring case, and
 * fetch would send both values joined into one header.
 */
function respelled(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const again: string[] = []
  for (const name of names) {
    const folded = name.toLowerCase()
    if (seen.has(folded)) again.push(name)
    seen.add(folded)
  }
  return again
}

/**
 * The headers: a name an HTTP token the client does not manage, a value fetch can send, no name
 * twice (in any spelling), and no secret header unless the policy lets the file hold a secret.
 */
function headerProblems(
  value: unknown,
  members: () => Members,
  policy: CredentialPolicy,
): Problem[] {
  if (!isHeaderMap(value)) return [{ code: "invalid", key: "headers" }]
  const { first, repeated } = members()
  const names = first.map(({ key }) => key)
  const twice = new Set([...repeated, ...respelled(names)])
  return [
    ...[...twice].map((name) => keyed("duplicate-key", "headers", name)),
    ...(policy === "env-or-literal" ? [] : names.filter(isSecretHeader).map(secretHeader)),
  ]
}

function keyProblems(
  key: ProfileKey,
  value: unknown,
  members: () => Members,
  policy: CredentialPolicy,
): Problem[] {
  if (key === "auth") {
    return isRecord(value) ? authProblems(value, members(), policy) : [{ code: "invalid", key }]
  }
  if (key === "headers") return headerProblems(value, members, policy)
  const code = VALUE_CHECKS[key](value)
  return code === undefined ? [] : [{ code, key }]
}

/**
 * Why the profile object `profile` is refused under `policy`. `members` are its keys as the text
 * `source` lists them: the keys it repeats, the unknown ones in the text's order, and where the
 * auth object and the headers sit, for the keys they repeat.
 */
export function profileProblems(
  profile: Readonly<Record<string, unknown>>,
  members: Members,
  source: string,
  policy: CredentialPolicy,
): Problem[] {
  const known: readonly string[] = PROFILE_KEYS
  const nested = (key: string) => () => {
    const member = members.first.find((candidate) => candidate.key === key)
    return member === undefined ? { first: [], repeated: [] } : objectMembers(source, member.start)
  }
  return [
    ...members.repeated.map((key) => keyed("duplicate-key", undefined, key)),
    ...members.first
      .filter(({ key }) => !known.includes(key))
      .map(({ key }) => keyed("unknown-key", undefined, key)),
    ...PROFILE_KEYS.filter((key) => Object.hasOwn(profile, key)).flatMap((key) =>
      keyProblems(key, profile[key], nested(key), policy),
    ),
  ]
}

/**
 * The profile a reader gets: the links normalized, the engine name trimmed. Only for a profile
 * without problems, so every key it holds passed its check above.
 */
export function usableProfile(profile: Readonly<Record<string, unknown>>): Profile {
  const { url, cockpitUrl, engine } = profile
  return {
    ...(profile as unknown as Profile),
    ...(typeof url === "string" ? { url: normalizeUrl(url) } : {}),
    ...(typeof cockpitUrl === "string" ? { cockpitUrl: normalizeCockpitUrl(cockpitUrl) } : {}),
    ...(typeof engine === "string" ? { engine: engine.trim() } : {}),
  }
}
