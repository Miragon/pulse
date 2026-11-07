import { describe, expect, test } from "vitest"
import { TargetsParser } from "../../src/host/connections/targets-parser.js"
import { UserConfigFile } from "../../src/host/connections/user-config-file.js"
import { CliFixtures, type CliFixture } from "./support/cli-fixtures.js"

const FILE = "/home/dev/.config/pulse-cli/config.json"

const fixtures = CliFixtures.read("user-config")

const expected = CliFixtures.expectations(
  new URL("user-config-fixtures.expected.json", import.meta.url),
)

function parsed(fixture: CliFixture) {
  return new TargetsParser(FILE).parse(fixture.text)
}

describe("the CLI's user config fixtures", () => {
  test("are there, valid and invalid files alike", () => {
    expect(fixtures.filter((fixture) => fixture.cli.valid).length).toBeGreaterThan(4)
    expect(fixtures.filter((fixture) => !fixture.cli.valid).length).toBeGreaterThan(4)
  })

  test("each have one expectation here, and each expectation a fixture", () => {
    expect(Object.keys(expected).sort()).toEqual(fixtures.map((fixture) => fixture.name).sort())
  })

  test.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    "%s: gives the targets and problems the extension expects",
    (name, fixture) => {
      const wanted = expected[name]
      expect(wanted, `${name} has no entry in user-config-fixtures.expected.json`).toBeDefined()
      const { targets, problems } = parsed(fixture)
      expect(targets.map((target) => target.name)).toEqual(wanted?.targets)
      expect(problems.map((problem) => problem.message)).toEqual(wanted?.problems)
      expect(problems.every((problem) => problem.path === FILE)).toBe(true)
    },
  )

  test.each(
    fixtures
      .filter((fixture) => fixture.cli.valid)
      .map((fixture) => [fixture.name, fixture] as const),
  )(
    "%s: makes every profile the CLI accepts a target like the CLI's or a named problem",
    (_name, fixture) => {
      CliFixtures.expectEveryAcceptedProfile(fixture, parsed(fixture))
    },
  )

  test.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    "%s: carries no credential of the file into a target",
    (_name, fixture) => {
      expect(JSON.stringify(parsed(fixture).targets)).not.toMatch(/secret/i)
    },
  )

  test("include the file Pulse creates, byte for byte", () => {
    expect(fixtures.find((fixture) => fixture.name === "valid-empty-file")?.text).toBe(
      UserConfigFile.EMPTY,
    )
  })
})
