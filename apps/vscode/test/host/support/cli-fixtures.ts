import { readdirSync, readFileSync } from "node:fs"
import { expect } from "vitest"
import type { EngineTarget } from "../../../src/host/connections/engine-target.js"
import type { ParsedTargets } from "../../../src/host/connections/targets-parser.js"

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

export interface CliFixture {
  readonly name: string
  readonly text: string
  readonly cli: CliVerdict
}

export interface Expected {
  readonly targets: readonly string[]
  readonly problems: readonly string[]
}

const FIXTURES = new URL("../../../../cli/test/fixtures/", import.meta.url)
const AUTH_KINDS: Readonly<Record<string, EngineTarget["auth"]["kind"]>> = {
  none: "none",
  basic: "basic",
  oauth: "oauth2",
}
const C7_FLAVORS = ["camunda7", "cibseven", "operaton"]

export class CliFixtures {
  static read(folder: "project-file" | "user-config"): readonly CliFixture[] {
    const directory = new URL(`${folder}/`, FIXTURES)
    return readdirSync(directory)
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map((entry) =>
        CliFixtures.fixtureOf(entry, JSON.parse(readFileSync(new URL(entry, directory), "utf8"))),
      )
  }

  static expectations(file: URL): Readonly<Record<string, Expected>> {
    return JSON.parse(readFileSync(file, "utf8")) as Readonly<Record<string, Expected>>
  }

  static expectEveryAcceptedProfile(fixture: CliFixture, parsed: ParsedTargets): void {
    const profiles = fixture.cli.valid ? fixture.cli.profiles : {}
    for (const name of Object.keys(profiles)) {
      const target = parsed.targets.find((candidate) => candidate.name === name)
      if (target === undefined) {
        const named = parsed.problems.some((problem) =>
          problem.message.startsWith(`profile "${name}" `),
        )
        expect(named, `profile "${name}" is neither a target nor a problem`).toBe(true)
      } else {
        CliFixtures.expectLikeTheCli(target, profiles[name])
      }
    }
  }

  private static expectLikeTheCli(target: EngineTarget, profile: CliProfile | undefined): void {
    expect(profile, `the CLI refuses profile "${target.name}"`).not.toHaveProperty("refused")
    const resolved = profile as ResolvedProfile
    expect(target.endpoint).toBe(resolved.url)
    expect(target.readOnly ?? false).toBe(resolved.readOnly)
    expect(target.webUiUrl).toBe(resolved.cockpitUrl)
    expect(target.auth.kind).toBe(AUTH_KINDS[resolved.auth])
    expect(C7_FLAVORS).toContain(resolved.flavor)
    expect([undefined, "default"]).toContain(resolved.engine)
  }

  private static fixtureOf(entry: string, raw: unknown): CliFixture {
    const cli = CliFixtures.isRecord(raw) ? raw.cli : undefined
    const verdict = CliFixtures.isVerdict(cli)
    const file =
      CliFixtures.isRecord(raw) && (Object.hasOwn(raw, "file") || typeof raw.text === "string")
    if (!CliFixtures.isRecord(raw) || !verdict || !file) {
      throw new Error(`${entry}: the CLI's fixture needs "file" or "text" and a "cli" verdict`)
    }
    return {
      name: entry.replace(/\.json$/, ""),
      text: typeof raw.text === "string" ? raw.text : `${JSON.stringify(raw.file, undefined, 2)}\n`,
      cli,
    }
  }

  private static isVerdict(cli: unknown): cli is CliVerdict {
    if (!CliFixtures.isRecord(cli)) {
      return false
    }
    return cli.valid === true
      ? CliFixtures.isRecord(cli.profiles)
      : cli.valid === false && typeof cli.error === "string"
  }

  private static isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }
}
