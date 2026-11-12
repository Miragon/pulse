/**
 * Test helpers of @miragon/pulse-profile: the shared fixtures, one per accepted and refused case,
 * each with its verdict under every credential policy and whether the JSON Schema accepts it;
 * and the one form both sides compare in (`outcomeOf`). A reader's tests run the fixtures through
 * its own path (the CLI's config layer, the VS Code extension's connections, the MCP server's
 * profiles) and hold what it makes of each verdict next to its tests. Data only: no file system,
 * no test framework.
 */

import {
  CREDENTIAL_POLICIES,
  type CredentialPolicy,
  type Problem,
  type Profile,
  type ProfileFile,
} from "../types.js"
import fixtures from "./profile-fixtures.json" with { type: "json" }

/** One profile of an outcome: its name (or position, for an invalid name) and its problems. */
export interface FixtureProfile {
  readonly name?: string
  readonly index?: number
  /** Each problem as `problemLabel` writes it; absent for a usable profile. */
  readonly problems?: readonly string[]
}

/** A ProfileFile in a form a fixture states and a test compares with `toEqual`. */
export interface FixtureOutcome {
  readonly problem?: string
  readonly notes?: readonly string[]
  readonly defaultProfile?: string
  readonly profiles?: readonly FixtureProfile[]
}

export interface ProfileFixture {
  readonly name: string
  /** One sentence on what the fixture pins. */
  readonly about: string
  /** The file's text. */
  readonly text: string
  /** Whether the JSON Schema accepts the file; never false where a policy accepts it silently. */
  readonly schema: boolean
  /** The parser's verdict under each credential policy. */
  readonly outcomes: Readonly<Record<CredentialPolicy, FixtureOutcome>>
  /** The profile a reader gets, for the named usable profiles whose normalization a case pins. */
  readonly usable: Readonly<Record<string, Profile>>
}

/** `code`, `code key`, or for invalid JSON `not-json (line L, column C)`. */
export function problemLabel({ code, key, line, column }: Problem): string {
  const where = line === undefined ? "" : ` (line ${String(line)}, column ${String(column)})`
  return `${code}${key === undefined ? "" : ` ${key}`}${where}`
}

/** `file` in the form of a fixture's outcome: what is set, nothing more. */
export function outcomeOf(file: ProfileFile): FixtureOutcome {
  const profiles = file.profiles.map(({ name, index, problems }) => ({
    ...(name === undefined ? { index } : { name }),
    ...(problems.length === 0 ? {} : { problems: problems.map(problemLabel) }),
  }))
  return {
    ...(file.problem === undefined ? {} : { problem: problemLabel(file.problem) }),
    ...(file.notes.length === 0 ? {} : { notes: file.notes.map(problemLabel) }),
    ...(file.defaultProfile === undefined ? {} : { defaultProfile: file.defaultProfile }),
    ...(profiles.length === 0 ? {} : { profiles }),
  }
}

const FIXTURE_KEYS: ReadonlySet<string> = new Set([
  "name",
  "about",
  "file",
  "text",
  "schema",
  "outcome",
  "outcomes",
  "usable",
])

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function outcomesOf(raw: Readonly<Record<string, unknown>>): ProfileFixture["outcomes"] {
  if (isRecord(raw.outcome)) {
    const outcome = raw.outcome as FixtureOutcome
    return { none: outcome, env: outcome, "env-or-literal": outcome }
  }
  const outcomes = raw.outcomes
  const complete =
    isRecord(outcomes) &&
    Object.keys(outcomes).length === CREDENTIAL_POLICIES.length &&
    CREDENTIAL_POLICIES.every((policy) => isRecord(outcomes[policy]))
  if (!complete) throw new Error("outcomes needs one outcome per credential policy")
  return outcomes as ProfileFixture["outcomes"]
}

/**
 * A fixture of the file, checked so that a renamed field fails by name: `name`, `about`, `file`
 * or `text`, `schema`, `outcome` (every policy) or `outcomes` (one per policy), maybe `usable`.
 */
function fixtureOf(raw: unknown): ProfileFixture {
  const fits =
    isRecord(raw) &&
    Object.keys(raw).every((key) => FIXTURE_KEYS.has(key)) &&
    typeof raw.name === "string" &&
    typeof raw.about === "string" &&
    typeof raw.schema === "boolean" &&
    Object.hasOwn(raw, "file") !== (typeof raw.text === "string") &&
    Object.hasOwn(raw, "outcome") !== Object.hasOwn(raw, "outcomes")
  if (!fits) throw new Error(`a profile fixture is malformed: ${JSON.stringify(raw).slice(0, 80)}`)
  return {
    name: raw.name as string,
    about: raw.about as string,
    text: typeof raw.text === "string" ? raw.text : `${JSON.stringify(raw.file, null, 2)}\n`,
    schema: raw.schema as boolean,
    outcomes: outcomesOf(raw),
    usable: (isRecord(raw.usable) ? raw.usable : {}) as ProfileFixture["usable"],
  }
}

/** Every fixture, in the order of the file. */
export const PROFILE_FIXTURES: readonly ProfileFixture[] = (fixtures as readonly unknown[]).map(
  fixtureOf,
)
