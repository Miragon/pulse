/**
 * The shared fixtures of @miragon/pulse-profile through the CLI's own path: each file as the
 * user's config file (`parseConfigFile`, policy env-or-literal) and as a project file
 * (`parseProjectFile`, policy none). The CLI fails the file exactly when the format gives no
 * profiles, refuses each profile the format refuses with the format's problems (and a usable one
 * only for what it cannot serve, the MCP server's passthrough), fails a command that uses a
 * refused profile with the format's sentence, and resolves every other profile, its credentials
 * completed from the environment.
 */

import { describeProblem, PROFILE_NAME } from "@miragon/pulse-profile"
import {
  type FixtureOutcome,
  PROFILE_FIXTURES,
  type ProfileFixture,
  problemLabel,
} from "@miragon/pulse-profile/testing"
import { describe, expect, it } from "vitest"
import { PulseCliError } from "../errors.js"
import { parseConfigFile } from "./file.js"
import { mergeProject, parseProjectFile } from "./project.js"
import { resolveConfig, selectProfile } from "./resolve.js"
import { type ConfigFile, ENV, type LoadedConfig, type Profile, type ProfileAuth } from "./types.js"

const PATH = "/repo/.pulse.json"

const READERS = [
  ["config file", "env-or-literal", (text: string) => parseConfigFile(text, PATH)],
  ["project file", "none", (text: string) => parseProjectFile(text, PATH)],
] as const

function loaded(kind: string, file: ConfigFile): LoadedConfig | undefined {
  if (kind === "config file") return file
  return mergeProject(undefined, { source: { path: PATH, directory: "/repo" }, file })
}

function failure(action: () => unknown): PulseCliError | undefined {
  try {
    action()
  } catch (error) {
    if (error instanceof PulseCliError) return error
    throw error
  }
  return undefined
}

/** The refused profiles as labels, the unnamed ones (never shown) by position. */
function refusedLabels(file: ConfigFile) {
  return Object.keys(file.profiles).flatMap((key, index) => {
    const problems = file.refused?.[key]
    if (problems === undefined) return []
    const where = PROFILE_NAME.test(key) ? { name: key } : { index }
    return [{ ...where, problems: problems.map(problemLabel) }]
  })
}

/** What the fixture's outcome refuses, plus what the CLI refuses of a usable profile. */
function expectedLabels(outcome: FixtureOutcome, file: ConfigFile) {
  return (outcome.profiles ?? []).flatMap(({ name, index, problems }) => {
    const passthrough =
      name !== undefined && file.profiles[name]?.auth?.type === ("passthrough" as never)
    const labels = problems ?? (passthrough ? ["auth-type-not-served auth.type"] : [])
    if (labels.length === 0) return []
    return [{ ...(name === undefined ? { index } : { name }), problems: labels }]
  })
}

/** The values Basic auth leaves to PULSE_CLI_USERNAME and PULSE_CLI_PASSWORD. */
function basicFallbacksOf(auth: ProfileAuth): Record<string, string> {
  const basic = auth.type === "basic" || (auth.type === undefined && auth.username !== undefined)
  if (!basic) return {}
  const password = auth.password ?? auth.passwordEnv
  return {
    ...(auth.username === undefined ? { [ENV.username]: "demo" } : {}),
    ...(password === undefined ? { [ENV.password]: "s3cret" } : {}),
  }
}

/** The values Basic auth and a bearer token leave to PULSE_CLI_USERNAME, _PASSWORD and _TOKEN. */
function fallbacksOf(auth: ProfileAuth): Record<string, string> {
  const token = auth.token ?? auth.tokenEnv
  return {
    ...basicFallbacksOf(auth),
    ...(auth.type === "bearer" && token === undefined ? { [ENV.token]: "t0k3n" } : {}),
  }
}

/** An environment that completes the credentials of `profile`: the variables it names, too. */
function environmentOf(profile: Profile | undefined): Readonly<Record<string, string>> {
  const auth = profile?.auth ?? {}
  const named = [auth.passwordEnv, auth.tokenEnv, auth.clientSecretEnv].filter(
    (variable) => typeof variable === "string",
  )
  return {
    ...Object.fromEntries(named.map((variable) => [variable, "s3cret"])),
    ...fallbacksOf(auth),
  }
}

function checkUse(fixture: ProfileFixture, kind: string, file: ConfigFile) {
  const config = loaded(kind, file)
  for (const name of Object.keys(file.profiles).filter((key) => PROFILE_NAME.test(key))) {
    const problems = file.refused?.[name]
    const env = environmentOf(file.profiles[name])
    const error = failure(() => resolveConfig({ profile: name }, env, config))
    if (problems !== undefined) {
      expect(error?.message, `${fixture.name}: ${name}`).toContain(
        `cannot be used: ${describeProblem(problems[0]!)}`,
      )
      continue
    }
    expect(error?.message, `${fixture.name}: ${name}`).toBeUndefined()
    expect(selectProfile({ profile: name }, env, config).name).toBe(name)
  }
}

describe("the shared profile fixtures through the CLI", () => {
  it("are there", () => {
    expect(PROFILE_FIXTURES.length).toBeGreaterThan(50)
  })

  describe.each(READERS)("as the %s (%s)", (kind, policy, parse) => {
    it.each(PROFILE_FIXTURES.map((fixture) => [fixture.name, fixture] as const))(
      "%s",
      (_name, fixture) => {
        const outcome = fixture.outcomes[policy]
        if (outcome.problem !== undefined) {
          const error = failure(() => parse(fixture.text))
          expect(error?.code).toBe("CONFIG")
          expect(error?.message).toMatch(new RegExp(`^Invalid ${kind} ${PATH}: `))
          return
        }
        const file = parse(fixture.text)
        expect(refusedLabels(file)).toEqual(expectedLabels(outcome, file))
        expect(file.notes?.map(problemLabel)).toEqual(outcome.notes)
        checkUse(fixture, kind, file)
      },
    )
  })
})
