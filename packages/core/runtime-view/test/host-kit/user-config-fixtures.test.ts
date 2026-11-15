import { readFileSync } from "node:fs"
import {
  authTypeOf,
  parseProfileFile,
  type Profile,
  SECRET_KEYS,
  VARIABLE_KEYS,
} from "@miragon/pulse-profile"
import { PROFILE_FIXTURES, type ProfileFixture } from "@miragon/pulse-profile/testing"
import { describe, expect, test } from "vitest"
import type { EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { ProfileSource } from "../../src/host-kit/connections/profile-source.js"
import { TargetsParser } from "../../src/host-kit/connections/targets-parser.js"

interface Expected {
  readonly targets: readonly string[]
  readonly problems: readonly string[]
}

const EXPECTED = new URL("user-config-fixtures.expected.json", import.meta.url)
const FILE = "/home/dev/.config/pulse-cli/config.json"
const CREDENTIAL_KEYS: readonly string[] = [...SECRET_KEYS, ...VARIABLE_KEYS]
const AUTH_KINDS: Readonly<Record<string, EngineTarget["auth"]["kind"]>> = {
  none: "none",
  basic: "basic",
  oauth: "oauth2",
}

const expected = JSON.parse(readFileSync(EXPECTED, "utf8")) as Readonly<Record<string, Expected>>

function parsed(fixture: ProfileFixture) {
  return new TargetsParser(FILE, ProfileSource.USER_CONFIG).parse(fixture.text)
}

function usableProfiles(fixture: ProfileFixture): [string, Profile][] {
  return parseProfileFile(fixture.text, { credentials: "env-or-literal" }).profiles.flatMap(
    (verdict) =>
      verdict.name === undefined || verdict.profile === undefined
        ? []
        : [[verdict.name, verdict.profile] as [string, Profile]],
  )
}

function credentialsOf(profile: Profile): string[] {
  return Object.entries(profile.auth ?? {}).flatMap(([key, value]: [string, unknown]) =>
    CREDENTIAL_KEYS.includes(key) && typeof value === "string" ? [value] : [],
  )
}

describe("the shared profile fixtures read as the CLI's user config", () => {
  test("hold credentials the format takes there, which a project file refuses", () => {
    const withCredentials = PROFILE_FIXTURES.filter((fixture) =>
      usableProfiles(fixture).some(([, profile]) => credentialsOf(profile).length > 0),
    )
    expect(withCredentials.length).toBeGreaterThan(5)
  })

  test("each have one expectation here, and each expectation a fixture", () => {
    expect(Object.keys(expected).sort()).toEqual(
      PROFILE_FIXTURES.map((fixture) => fixture.name).sort(),
    )
  })

  test.each(PROFILE_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: gives the targets and problems the editors expect",
    (name, fixture) => {
      const wanted = expected[name]
      expect(wanted, `${name} has no entry in user-config-fixtures.expected.json`).toBeDefined()
      const { targets, problems } = parsed(fixture)
      expect(targets.map((target) => target.name)).toEqual(wanted?.targets)
      expect(problems.map((problem) => problem.message)).toEqual(wanted?.problems)
      for (const problem of problems) {
        expect(problem.path).toBe(FILE)
        expect(problem.label()).toBe(`CLI config: ${problem.message}`)
      }
    },
  )

  test.each(PROFILE_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: makes every profile the format takes a target like it or a named problem",
    (_name, fixture) => {
      const { targets, problems } = parsed(fixture)
      for (const [name, profile] of usableProfiles(fixture)) {
        const target = targets.find((candidate) => candidate.name === name)
        if (target === undefined) {
          const named = problems.some((problem) =>
            problem.message.startsWith(`profile "${name}": `),
          )
          expect(named, `profile "${name}" is neither a target nor a problem`).toBe(true)
        } else {
          expect(target.endpoint).toBe(profile.url)
          expect(target.auth.kind).toBe(AUTH_KINDS[authTypeOf(profile)])
          expect(target.source).toEqual({ kind: "user-config", path: FILE })
        }
      }
    },
  )

  test.each(PROFILE_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: carries no credential of the file into a target",
    (_name, fixture) => {
      const carried = JSON.stringify(parsed(fixture).targets)
      for (const [, profile] of usableProfiles(fixture)) {
        for (const credential of credentialsOf(profile)) {
          expect(carried).not.toContain(credential)
        }
      }
    },
  )
})
