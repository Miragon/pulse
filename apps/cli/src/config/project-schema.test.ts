/**
 * The JSON Schema of the project file against the parser: every shared fixture
 * (apps/cli/test/fixtures/project-file/) gets the same verdict from both, and every profile of a
 * valid fixture resolves to the values the fixture names, which Pulse for VS Code's targets must
 * show too (its test reads the same files). The schema's lists come from the CLI's own constants.
 */

import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  type ExpectedProfile,
  type Fixture,
  fixtures,
  parserVerdict,
  PROJECT_PATH,
  SCHEMA,
  SCHEMA_URL,
  type SchemaNode,
  schemaVerdict,
} from "../../test/support/project-schema.js"
import { PulseCliError } from "../errors.js"
import { compact } from "../util.js"
import { mergeProject, parseProjectFile } from "./project.js"
import { resolveConfig, selectProfile } from "./resolve.js"
import { pickAuthType } from "./resolve-auth.js"
import {
  AUTH_TYPES,
  BASIC_AUTH_KEYS,
  BEARER_AUTH_KEYS,
  PROFILE_FLAVORS,
  OAUTH_AUTH_KEYS,
  OUTPUT_FORMATS,
  PROFILE_AUTH_KEYS,
  PROFILE_KEYS,
} from "./types.js"

const FIXTURES = fixtures()
const VALID = FIXTURES.filter((fixture) => fixture.cli.valid)
const INVALID = FIXTURES.filter((fixture) => !fixture.cli.valid)

/** The credentials a project file refuses: the secrets and the variables that hold them. */
const CREDENTIALS = [
  "password",
  "passwordEnv",
  "clientSecret",
  "clientSecretEnv",
  ...BEARER_AUTH_KEYS,
] as const

function definition(name: string): SchemaNode {
  const node = SCHEMA.definitions?.[name]
  if (node === undefined) throw new Error(`the schema has no definition ${name}`)
  return node
}

function propertyNames(node: SchemaNode): string[] {
  return Object.keys(node.properties ?? {}).sort()
}

/** How the CLI uses profile `name` of the file: resolved without flags or environment. */
function cliView(text: string, name: string): ExpectedProfile {
  const file = parseProjectFile(text, PROJECT_PATH)
  const loaded = mergeProject(undefined, {
    source: { path: PROJECT_PATH, directory: "/repo" },
    file,
  })
  try {
    // `--auth none` resolves the rest without credentials, which a project file never holds; the
    // auth type is the one resolveAuth picks for the profile without flags or environment
    const resolved = resolveConfig({ profile: name, auth: "none" }, {}, loaded)
    const auth = pickAuthType({}, {}, selectProfile({ profile: name }, {}, loaded)) ?? "none"
    const { url, flavor, readOnly, cockpitUrl, engine } = resolved
    return { url, flavor, readOnly, auth, ...compact({ cockpitUrl, engine }) }
  } catch (error) {
    if (error instanceof PulseCliError && error.code === "CONFIG") return { refused: error.message }
    throw error
  }
}

function expectProfile(fixture: Fixture, name: string, expected: ExpectedProfile): void {
  const actual = cliView(fixture.text, name)
  if ("refused" in expected) {
    expect(actual, `${fixture.name}: ${name}`).toEqual({
      refused: expect.stringContaining(expected.refused) as string,
    })
  } else {
    expect(actual, `${fixture.name}: ${name}`).toStrictEqual(expected)
  }
}

describe("the project file fixtures", () => {
  it("cover valid and invalid files, each with a sentence on what it pins", () => {
    expect(VALID.length).toBeGreaterThan(10)
    expect(INVALID.length).toBeGreaterThan(20)
    for (const fixture of FIXTURES) expect(fixture.about, fixture.name).toMatch(/^\S.+\.$/)
    for (const fixture of FIXTURES) {
      expect(fixture.name.startsWith(fixture.cli.valid ? "valid-" : "invalid-"), fixture.name).toBe(
        true,
      )
    }
  })

  it.each(FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
    "%s: the parser and the schema agree with the fixture",
    (_name, fixture) => {
      const parser = parserVerdict(fixture.text)
      const schema = schemaVerdict(fixture.text)
      expect(parser.valid, `parser: ${parser.valid ? "" : parser.reason}`).toBe(fixture.cli.valid)
      expect(schema.valid, `schema: ${schema.valid ? "" : schema.reason}`).toBe(fixture.cli.valid)
      if (!fixture.cli.valid && !parser.valid) expect(parser.reason).toContain(fixture.cli.error)
    },
  )

  it.each(VALID.map((fixture) => [fixture.name, fixture] as const))(
    "%s: each profile resolves as the fixture says",
    (_name, fixture) => {
      if (!fixture.cli.valid) return
      const file = parseProjectFile(fixture.text, PROJECT_PATH)
      expect(Object.keys(fixture.cli.profiles)).toEqual(Object.keys(file.profiles))
      for (const [name, expected] of Object.entries(fixture.cli.profiles)) {
        expectProfile(fixture, name, expected)
      }
    },
  )
})

describe("the project file schema", () => {
  it("names the profile keys, flavors and output formats of the CLI", () => {
    const profile = definition("profile")
    expect(propertyNames(profile)).toEqual([...PROFILE_KEYS].sort())
    expect(profile.additionalProperties).toBe(false)
    expect(profile.properties?.flavor?.enum).toEqual(PROFILE_FLAVORS)
    expect(profile.properties?.output?.enum).toEqual(OUTPUT_FORMATS)
    expect(propertyNames(SCHEMA)).toEqual(["$schema", "defaultProfile", "profiles"])
    expect(SCHEMA.additionalProperties).toBe(false)
  })

  it("names every auth key, refuses the credentials and offers the auth types", () => {
    const auth = definition("auth")
    expect(propertyNames(auth)).toEqual([...PROFILE_AUTH_KEYS].sort())
    const refused = Object.entries(auth.properties ?? {})
      .filter(([, node]) => node.$ref === "#/definitions/credential")
      .map(([key]) => key)
    expect(refused.sort()).toEqual([...CREDENTIALS].sort())
    expect(auth.properties?.type?.examples).toEqual(AUTH_TYPES)
    const settings = OAUTH_AUTH_KEYS.filter(
      (key) => !(CREDENTIALS as readonly string[]).includes(key),
    )
    const basic = BASIC_AUTH_KEYS.filter((key) => !(CREDENTIALS as readonly string[]).includes(key))
    expect(Object.keys(auth.dependencies ?? {}).sort()).toEqual([...basic, ...settings].sort())
  })

  it("ships with the package and names where it is published", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as { readonly name: string; readonly files: readonly string[] }
    expect(manifest.files).toContain("schema")
    const published = SCHEMA_URL.pathname.slice(SCHEMA_URL.pathname.lastIndexOf("/schema/"))
    expect(SCHEMA.$id).toBe(`https://unpkg.com/${manifest.name}${published}`)
  })
})
