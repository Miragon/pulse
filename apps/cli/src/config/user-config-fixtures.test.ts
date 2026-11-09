/**
 * The user's config file against the parser: every shared fixture
 * (apps/cli/test/fixtures/user-config/) gets its verdict from parseConfigFile, and every profile of
 * a valid fixture resolves to the values the fixture names, which Pulse for VS Code's targets must
 * show too (its test reads the same files). Unlike a project file, the user's own file may hold
 * credentials and a defaultProfile of another file.
 */

import { describe, expect, it } from "vitest"
import { type ExpectedProfile, type Fixture, fixtures } from "../../test/support/project-schema.js"
import { PulseCliError } from "../errors.js"
import { compact } from "../util.js"
import { parseConfigFile } from "./file.js"
import { configOrigin } from "./login-key.js"
import { projectProblem } from "./project.js"
import { resolveConfig, selectProfile } from "./resolve.js"
import { pickAuthType } from "./resolve-auth.js"
import type { LoadedConfig } from "./types.js"

const FIXTURES = fixtures("user-config")
const VALID = FIXTURES.filter((fixture) => fixture.cli.valid)
const USER_PATH = "/home/dev/.config/pulse-cli/config.json"

function loaded(text: string): LoadedConfig {
  return { ...parseConfigFile(text, USER_PATH), origin: configOrigin(USER_PATH, "/", "linux") }
}

function verdict(text: string): { readonly valid: true } | { readonly reason: string } {
  try {
    parseConfigFile(text, USER_PATH)
    return { valid: true }
  } catch (error) {
    if (error instanceof PulseCliError && error.code === "CONFIG") return { reason: error.message }
    throw error
  }
}

/** How the CLI uses profile `name` of the user's file: resolved without flags or environment. */
function cliView(text: string, name: string): ExpectedProfile {
  const config = loaded(text)
  // `--auth none` resolves the rest without reading a credential; the auth type is the one
  // resolveAuth picks for the profile without flags or environment
  const resolved = resolveConfig({ profile: name, auth: "none" }, {}, config)
  const auth = pickAuthType({}, {}, selectProfile({ profile: name }, {}, config)) ?? "none"
  const { url, flavor, readOnly, cockpitUrl, engine } = resolved
  return { url, flavor, readOnly, auth, ...compact({ cockpitUrl, engine }) }
}

function expectProfiles(fixture: Fixture): void {
  if (!fixture.cli.valid) return
  expect(Object.keys(fixture.cli.profiles)).toEqual(Object.keys(loaded(fixture.text).profiles))
  for (const [name, expected] of Object.entries(fixture.cli.profiles)) {
    expect(cliView(fixture.text, name), `${fixture.name}: ${name}`).toStrictEqual(expected)
  }
}

describe("the user config fixtures", () => {
  it("cover valid and invalid files, each with a sentence on what it pins", () => {
    expect(VALID.length).toBeGreaterThan(4)
    expect(FIXTURES.length - VALID.length).toBeGreaterThan(4)
    for (const fixture of FIXTURES) {
      expect(fixture.about, fixture.name).toMatch(/^\S.+\.$/)
      expect(fixture.name.startsWith(fixture.cli.valid ? "valid-" : "invalid-"), fixture.name).toBe(
        true,
      )
    }
  })

  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: the parser agrees with the fixture",
    (_name, fixture) => {
      const actual = verdict(fixture.text)
      if (fixture.cli.valid) expect(actual).toEqual({ valid: true })
      else expect(actual).toEqual({ reason: expect.stringContaining(fixture.cli.error) as string })
    },
  )

  it.each(VALID.map((fixture) => [fixture.name, fixture] as const))(
    "%s: each profile resolves as the fixture says",
    (_name, fixture) => {
      expectProfiles(fixture)
    },
  )

  it("hold credentials and foreign defaults a project file refuses", () => {
    const refused = VALID.filter(
      (fixture) => projectProblem(parseConfigFile(fixture.text, USER_PATH)) !== undefined,
    )
    expect(refused.map((fixture) => fixture.name)).toEqual([
      "valid-bearer-token",
      "valid-credentials",
      "valid-default-profile-elsewhere",
      "valid-secret-headers",
    ])
  })
})
