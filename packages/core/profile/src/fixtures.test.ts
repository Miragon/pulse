/**
 * The shared fixtures against the parser: every fixture gets, under every credential policy, the
 * verdict it states, and the usable profiles it pins come out normalized as it says. The JSON
 * Schema's side of the same fixtures is test/schema.test.ts's. The cases of where the CLI's user
 * config lives are data the readers run; here they only hold their own shape.
 */

import { describe, expect, it } from "vitest"
import { parseProfileFile } from "./parse.js"
import { CLI_CONFIG_LOCATIONS, outcomeOf, PROFILE_FIXTURES, problemLabel } from "./testing/index.js"
import { CREDENTIAL_POLICIES, PROBLEM_CODES } from "./types.js"

const CASES = PROFILE_FIXTURES.flatMap((fixture) =>
  CREDENTIAL_POLICIES.map((policy) => [fixture.name, policy, fixture] as const),
)

describe("the shared profile fixtures", () => {
  it("are many, each named once, each with a sentence on what it pins", () => {
    expect(PROFILE_FIXTURES.length).toBeGreaterThan(70)
    const names = PROFILE_FIXTURES.map((fixture) => fixture.name)
    expect(new Set(names).size).toBe(names.length)
    for (const fixture of PROFILE_FIXTURES) expect(fixture.about, fixture.name).toMatch(/^\S.+\.$/)
  })

  it("cover files that fail, notes, refused and usable profiles, and every policy apart", () => {
    const outcomes = PROFILE_FIXTURES.flatMap((fixture) => Object.values(fixture.outcomes))
    expect(outcomes.some((outcome) => outcome.problem !== undefined)).toBe(true)
    expect(outcomes.some((outcome) => outcome.notes !== undefined)).toBe(true)
    const profiles = outcomes.flatMap((outcome) => outcome.profiles ?? [])
    expect(profiles.some((profile) => profile.problems === undefined)).toBe(true)
    expect(profiles.some((profile) => profile.index !== undefined)).toBe(true)
    const apart = PROFILE_FIXTURES.filter(
      ({ outcomes: o }) =>
        JSON.stringify(o.none) !== JSON.stringify(o.env) &&
        JSON.stringify(o.env) !== JSON.stringify(o["env-or-literal"]),
    )
    expect(apart.length).toBeGreaterThan(5)
  })

  it("name every code a file can earn, the readers' codes aside", () => {
    const earned = new Set(
      PROFILE_FIXTURES.flatMap((fixture) => {
        const policies = CREDENTIAL_POLICIES.map((credentials) =>
          parseProfileFile(fixture.text, { credentials }),
        )
        return policies.flatMap((file) => [
          ...(file.problem === undefined ? [] : [file.problem.code]),
          ...file.notes.map((note) => note.code),
          ...file.profiles.flatMap((profile) => profile.problems.map((problem) => problem.code)),
        ])
      }),
    )
    // The codes of a reader's own rules: what it cannot serve, and its token endpoint's fragment.
    const readers = PROBLEM_CODES.filter(
      (code) => code.endsWith("-served") || code === "url-missing" || code === "url-fragment",
    )
    expect(PROBLEM_CODES.filter((code) => !earned.has(code) && !readers.includes(code))).toEqual([])
  })

  it.each(CASES)("%s under %s: gives the verdict the fixture states", (_name, policy, fixture) => {
    const file = parseProfileFile(fixture.text, { credentials: policy })
    expect(outcomeOf(file)).toEqual(fixture.outcomes[policy])
  })

  it.each(PROFILE_FIXTURES.filter((fixture) => Object.keys(fixture.usable).length > 0))(
    "$name: the usable profiles come out normalized",
    (fixture) => {
      for (const policy of CREDENTIAL_POLICIES) {
        const file = parseProfileFile(fixture.text, { credentials: policy })
        for (const [name, profile] of Object.entries(fixture.usable)) {
          const verdict = file.profiles.find((candidate) => candidate.name === name)
          expect(verdict?.profile, `${name} under ${policy}`).toStrictEqual(profile)
        }
      }
    },
  )
})

describe("problemLabel", () => {
  it("writes the code, the key and where JSON text stops being valid", () => {
    expect(problemLabel({ code: "invalid" })).toBe("invalid")
    expect(problemLabel({ code: "invalid", key: "url" })).toBe("invalid url")
    expect(problemLabel({ code: "not-json", line: 3, column: 14 })).toBe(
      "not-json (line 3, column 14)",
    )
  })
})

describe("the cases of where the CLI's user config lives", () => {
  it("each say what they pin and cover every platform, variable and outcome", () => {
    for (const { about } of CLI_CONFIG_LOCATIONS) expect(about).toMatch(/^\S.+\.$/)
    const abouts = CLI_CONFIG_LOCATIONS.map(({ about }) => about)
    expect(new Set(abouts).size).toBe(abouts.length)
    const platforms = new Set(CLI_CONFIG_LOCATIONS.map(({ platform }) => platform))
    expect([...platforms].sort()).toEqual(["darwin", "linux", "win32"])
    const variables = new Set(CLI_CONFIG_LOCATIONS.flatMap(({ env }) => Object.keys(env)))
    expect([...variables].sort()).toEqual(["APPDATA", "PULSE_CLI_CONFIG", "XDG_CONFIG_HOME"])
    const named = CLI_CONFIG_LOCATIONS.filter(({ explicit }) => explicit)
    expect(named.length).toBeGreaterThan(2)
    expect(named.every(({ env, path }) => env.PULSE_CLI_CONFIG === path)).toBe(true)
  })

  it("end in the CLI's folder and file wherever no variable names the file", () => {
    const found = CLI_CONFIG_LOCATIONS.filter(({ explicit }) => !explicit)
    expect(found.length).toBeGreaterThan(8)
    for (const { path } of found) expect(path).toMatch(/[/\\]pulse-cli[/\\]config\.json$/)
  })
})
