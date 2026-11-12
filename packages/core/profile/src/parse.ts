/**
 * The parser: the text of a profile file in, a verdict per profile out. Only text that gives no
 * profiles at all fails the file (invalid JSON, a root or a `profiles` that is no object, a root
 * key twice); everything else refuses the one profile it concerns, and what is off at the root
 * besides the profiles is a note. Reading the file, the environment and the secrets is the
 * reader's, and so is the wording (`describeProblem` offers one without values).
 */

import {
  jsonErrorPosition,
  type Member,
  type Members,
  objectMembers,
  rootStart,
} from "./json-text.js"
import { keyed } from "./keys.js"
import { profileProblems, usableProfile } from "./profile.js"
import { isRecord, PROFILE_NAME } from "./syntax.js"
import {
  type CredentialPolicy,
  type Problem,
  type ProfileFile,
  type ProfileVerdict,
  ROOT_KEYS,
} from "./types.js"

export interface ParseOptions {
  /** What the file may hold of credentials: where it comes from (CredentialPolicy). */
  readonly credentials: CredentialPolicy
}

const BYTE_ORDER_MARK = "\uFEFF"

function failed(problem: Problem, notes: readonly Problem[] = []): ProfileFile {
  return { problem, notes, profiles: [] }
}

/** JSON.parse, and on invalid text where it stops being valid, never the text itself. */
function parsedJson(text: string): { readonly value: unknown } | { readonly problem: Problem } {
  try {
    return { value: JSON.parse(text) as unknown }
  } catch {
    const position = jsonErrorPosition(text)
    return { problem: { code: "not-json", ...position } }
  }
}

function memberOf(members: Members, key: string): Member | undefined {
  return members.first.find((member) => member.key === key)
}

/** What every profile of a file is read against: its text, its repeated names, its policy. */
interface FileContext {
  readonly source: string
  readonly repeated: readonly string[]
  readonly policy: CredentialPolicy
}

function verdictOf(
  context: FileContext,
  member: Member,
  value: unknown,
  index: number,
): ProfileVerdict {
  const { source, repeated, policy } = context
  const named = PROFILE_NAME.test(member.key)
  const problems: Problem[] = [
    ...(named ? [] : [{ code: "invalid-name" } as const]),
    ...(repeated.includes(member.key) ? [{ code: "duplicate-name" } as const] : []),
    ...(isRecord(value)
      ? profileProblems(value, objectMembers(source, member.start), source, policy)
      : [{ code: "invalid" } as const]),
  ]
  const usable = problems.length === 0 && isRecord(value)
  return {
    ...(named ? { name: member.key } : {}),
    index,
    problems,
    ...(usable ? { profile: usableProfile(value) } : {}),
  }
}

/** Every profile in the order of the text; a name the text repeats is one refused profile. */
function verdictsOf(
  source: string,
  member: Member,
  profiles: Readonly<Record<string, unknown>>,
  policy: CredentialPolicy,
): ProfileVerdict[] {
  const { first, repeated } = objectMembers(source, member.start)
  const context: FileContext = { source, repeated, policy }
  return first.map((profile, index) => verdictOf(context, profile, profiles[profile.key], index))
}

/** Unknown root keys, in the order of the text, and a `$schema` that is no string. */
function rootNotes(root: Readonly<Record<string, unknown>>, members: Members): Problem[] {
  const known: readonly string[] = ROOT_KEYS
  return [
    ...members.first
      .filter(({ key }) => !known.includes(key))
      .map(({ key }) => keyed("unknown-root-key", undefined, key)),
    ...(Object.hasOwn(root, "$schema") && typeof root.$schema !== "string"
      ? [{ code: "invalid", key: "$schema" } as const]
      : []),
  ]
}

/**
 * `defaultProfile`: blank means none; otherwise a valid name of one of the file's profiles, or a
 * note. A note never falls back to another profile (defaultProfileOf).
 */
function defaultOf(
  value: unknown,
  verdicts: readonly ProfileVerdict[],
): { readonly defaultProfile?: string; readonly notes: readonly Problem[] } {
  if (value === undefined) return { notes: [] }
  if (typeof value !== "string") return { notes: [{ code: "invalid", key: "defaultProfile" }] }
  const name = value.trim()
  if (name === "") return { notes: [] }
  if (!PROFILE_NAME.test(name)) return { notes: [{ code: "invalid-name", key: "defaultProfile" }] }
  return verdicts.some((verdict) => verdict.name === name)
    ? { defaultProfile: name, notes: [] }
    : { notes: [{ code: "default-not-found", key: "defaultProfile" }] }
}

function fileOf(
  source: string,
  root: Readonly<Record<string, unknown>>,
  members: Members,
  policy: CredentialPolicy,
): ProfileFile {
  const notes = rootNotes(root, members)
  const { profiles, $schema } = root
  if (profiles !== undefined && !isRecord(profiles)) {
    return failed({ code: "profiles-not-object", key: "profiles" }, notes)
  }
  const member = memberOf(members, "profiles")
  const verdicts =
    member === undefined || profiles === undefined
      ? []
      : verdictsOf(source, member, profiles, policy)
  const chosen = defaultOf(root.defaultProfile, verdicts)
  return {
    notes: [...notes, ...chosen.notes],
    ...(typeof $schema === "string" ? { schema: $schema } : {}),
    ...(chosen.defaultProfile === undefined ? {} : { defaultProfile: chosen.defaultProfile }),
    profiles: verdicts,
  }
}

/**
 * Parses the text of a profile file under the credential policy of where it comes from. Never
 * throws for any text, and no verdict repeats a value of the file.
 */
export function parseProfileFile(text: string, options: ParseOptions): ProfileFile {
  const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text
  const parsed = parsedJson(source)
  if ("problem" in parsed) return failed(parsed.problem)
  if (!isRecord(parsed.value)) return failed({ code: "root-not-object" })
  const members = objectMembers(source, rootStart(source))
  const [repeated] = members.repeated
  if (repeated !== undefined) return failed(keyed("duplicate-key", undefined, repeated))
  return fileOf(source, parsed.value, members, options.credentials)
}

/**
 * The profile a reader uses when none is named: the file's `defaultProfile`, else its only
 * profile (counted with the refused ones, so a broken neighbour never reroutes to the other). A
 * `defaultProfile` that is off (a note) gives none: it never falls back to the only profile.
 */
export function defaultProfileOf(file: ProfileFile): string | undefined {
  if (file.problem !== undefined) return undefined
  if (file.defaultProfile !== undefined) return file.defaultProfile
  if (file.notes.some((note) => note.key === "defaultProfile")) return undefined
  const [only, ...more] = file.profiles
  return more.length === 0 ? only?.name : undefined
}
