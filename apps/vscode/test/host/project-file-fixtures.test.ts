import { readdirSync, readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import type { EngineTarget } from "../../src/host/connections/engine-target.js"
import { TargetsParser } from "../../src/host/connections/targets-parser.js"

interface ResolvedProfile {
  readonly url: string
  readonly flavor: string
  readonly readOnly: boolean
  readonly auth: string
  readonly cockpitUrl?: string
  readonly engine?: string
}

type CliProfile = ResolvedProfile | { readonly refused: string }

type CliVerdict =
  | { readonly valid: true; readonly profiles: Readonly<Record<string, CliProfile>> }
  | { readonly valid: false; readonly error: string }

interface Fixture {
  readonly name: string
  readonly text: string
  readonly cli: CliVerdict
}

interface Expected {
  readonly targets: readonly string[]
  readonly problems: readonly string[]
}

const FIXTURES = new URL("../../../cli/test/fixtures/project-file/", import.meta.url)
const EXPECTED = new URL("project-file-fixtures.expected.json", import.meta.url)
const FILE = "/work/.pulse-cli.json"
const AUTH_KINDS: Readonly<Record<string, EngineTarget["auth"]["kind"]>> = {
  none: "none",
  basic: "basic",
  oauth: "oauth2",
}
const C7_FLAVORS = ["camunda7", "cibseven", "operaton"]

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isVerdict(cli: unknown): cli is CliVerdict {
  if (!isRecord(cli)) {
    return false
  }
  return cli.valid === true
    ? isRecord(cli.profiles)
    : cli.valid === false && typeof cli.error === "string"
}

function fixtureOf(entry: string, raw: unknown): Fixture {
  const cli = isRecord(raw) ? raw.cli : undefined
  const verdict = isVerdict(cli)
  const file = isRecord(raw) && (Object.hasOwn(raw, "file") || typeof raw.text === "string")
  if (!isRecord(raw) || !verdict || !file) {
    throw new Error(`${entry}: the CLI's fixture needs "file" or "text" and a "cli" verdict`)
  }
  return {
    name: entry.replace(/\.json$/, ""),
    text: typeof raw.text === "string" ? raw.text : `${JSON.stringify(raw.file, undefined, 2)}\n`,
    cli,
  }
}

const fixtures: readonly Fixture[] = readdirSync(FIXTURES)
  .filter((entry) => entry.endsWith(".json"))
  .sort()
  .map((entry) => fixtureOf(entry, JSON.parse(readFileSync(new URL(entry, FIXTURES), "utf8"))))

const expected = JSON.parse(readFileSync(EXPECTED, "utf8")) as Readonly<Record<string, Expected>>

function parsed(fixture: Fixture) {
  return new TargetsParser(FILE).parse(fixture.text)
}

function writtenTokenEndpoint(fixture: Fixture, name: string): unknown {
  const file: unknown = JSON.parse(fixture.text)
  const profile = isRecord(file) && isRecord(file.profiles) ? file.profiles[name] : undefined
  const auth = isRecord(profile) ? profile.auth : undefined
  return isRecord(auth) ? auth.tokenEndpoint : undefined
}

function expectTokenEndpointAsWritten(target: EngineTarget, written: unknown): void {
  if (target.auth.kind === "clientCredentials") {
    expect(typeof written).toBe("string")
    expect(
      target.auth.tokenEndpoint,
      "the CLI keeps an OAuth endpoint trimmed, else as written",
    ).toBe(String(written).trim())
  }
}

function expectLikeTheCli(
  target: EngineTarget,
  profile: CliProfile | undefined,
  written: unknown,
): void {
  if (target.engine === "c8") {
    expect(profile, "the CLI has no adapter for a camunda8 profile").toMatchObject({
      refused: expect.stringContaining("Camunda 8") as unknown,
    })
    expectTokenEndpointAsWritten(target, written)
    return
  }
  expect(profile, `the CLI refuses profile "${target.name}"`).not.toHaveProperty("refused")
  const resolved = profile as ResolvedProfile
  expect(target.endpoint).toBe(resolved.url)
  expect(target.readOnly ?? false).toBe(resolved.readOnly)
  expect(target.webUiUrl).toBe(resolved.cockpitUrl)
  expect(target.auth.kind).toBe(AUTH_KINDS[resolved.auth])
  expect(C7_FLAVORS).toContain(resolved.flavor)
  expect([undefined, "default"]).toContain(resolved.engine)
}

describe("the CLI's project file fixtures", () => {
  test("are there, valid and invalid files alike", () => {
    expect(fixtures.filter((fixture) => fixture.cli.valid).length).toBeGreaterThan(10)
    expect(fixtures.filter((fixture) => !fixture.cli.valid).length).toBeGreaterThan(20)
  })

  test("each have one expectation here, and each expectation a fixture", () => {
    expect(Object.keys(expected).sort()).toEqual(fixtures.map((fixture) => fixture.name).sort())
  })

  test.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
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

  test.each(
    fixtures
      .filter((fixture) => fixture.cli.valid)
      .map((fixture) => [fixture.name, fixture] as const),
  )(
    "%s: makes every profile the CLI accepts a target like the CLI's or a named problem",
    (_name, fixture) => {
      const { targets, problems } = parsed(fixture)
      const profiles = fixture.cli.valid ? fixture.cli.profiles : {}
      for (const name of Object.keys(profiles)) {
        const target = targets.find((candidate) => candidate.name === name)
        if (target === undefined) {
          const named = problems.some((problem) => problem.message.startsWith(`profile "${name}" `))
          expect(named, `profile "${name}" is neither a target nor a problem`).toBe(true)
        } else {
          expectLikeTheCli(target, profiles[name], writtenTokenEndpoint(fixture, name))
        }
      }
    },
  )
})
