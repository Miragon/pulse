import { readFileSync } from "node:fs"
import { authTypeOf, parseProfileFile, type Profile } from "@miragon/pulse-profile"
import { PROFILE_FIXTURES, type ProfileFixture } from "@miragon/pulse-profile/testing"
import { describe, expect, test } from "vitest"
import type { EngineTarget } from "../../src/host-kit/connections/engine-target.js"
import { TargetsParser } from "../../src/host-kit/connections/targets-parser.js"

interface Expected {
  readonly targets: readonly string[]
  readonly problems: readonly string[]
}

const EXPECTED = new URL("project-file-fixtures.expected.json", import.meta.url)
const FILE = "/work/.pulse.json"
const AUTH_KINDS: Readonly<Record<string, EngineTarget["auth"]["kind"]>> = {
  none: "none",
  basic: "basic",
  oauth: "oauth2",
}

const expected = JSON.parse(readFileSync(EXPECTED, "utf8")) as Readonly<Record<string, Expected>>

function parsed(fixture: ProfileFixture) {
  return new TargetsParser(FILE).parse(fixture.text)
}

function usableProfiles(fixture: ProfileFixture): [string, Profile][] {
  return parseProfileFile(fixture.text, { credentials: "none" }).profiles.flatMap((verdict) =>
    verdict.name === undefined || verdict.profile === undefined
      ? []
      : [[verdict.name, verdict.profile] as [string, Profile]],
  )
}

function expectLikeTheFormat(target: EngineTarget, profile: Profile): void {
  expect(target.endpoint).toBe(profile.url)
  expect(target.readOnly ?? false).toBe(profile.readOnly ?? false)
  expect(target.webUiUrl).toBe(profile.cockpitUrl)
  expect(target.auth.kind).toBe(AUTH_KINDS[authTypeOf(profile)])
  expect(target.engine).toBe("c7")
  expect([undefined, "default"]).toContain(profile.engine)
}

describe("the shared profile fixtures of @miragon/pulse-profile", () => {
  test("are there, usable and refused profiles alike", () => {
    expect(
      PROFILE_FIXTURES.filter((fixture) => usableProfiles(fixture).length > 0).length,
    ).toBeGreaterThan(20)
    expect(
      PROFILE_FIXTURES.filter((fixture) => fixture.outcomes.none.problem !== undefined).length,
    ).toBeGreaterThan(3)
  })

  test("each have one expectation here, and each expectation a fixture", () => {
    expect(Object.keys(expected).sort()).toEqual(
      PROFILE_FIXTURES.map((fixture) => fixture.name).sort(),
    )
  })

  test.each(PROFILE_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: gives the targets and problems the extension expects",
    (name, fixture) => {
      const wanted = expected[name]
      expect(wanted, `${name} has no entry in project-file-fixtures.expected.json`).toBeDefined()
      const { targets, problems } = parsed(fixture)
      expect(targets.map((target) => target.name)).toEqual(wanted?.targets)
      expect(problems.map((problem) => problem.message)).toEqual(wanted?.problems)
      expect(problems.every((problem) => problem.path === FILE)).toBe(true)
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
          expectLikeTheFormat(target, profile)
        }
      }
    },
  )
})
