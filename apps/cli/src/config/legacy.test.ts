/**
 * The names operate released up to 0.10.0 (legacy.ts): which variables map to which, the old
 * program name and the one warning. The literal names below are the contract with existing setups.
 */

import { readFileSync } from "node:fs"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  isLegacyProgram,
  LEGACY_CONFIG_DIRECTORY,
  LEGACY_DOCS,
  LEGACY_ENV_PREFIX,
  LEGACY_PROGRAM,
  LEGACY_PROGRAM_USE,
  LEGACY_PROJECT_FILE,
  LEGACY_REMOVAL,
  type LegacyUse,
  legacyVariable,
  legacyWarning,
  withLegacyEnv,
} from "./legacy.js"
import { ENV, ENV_PREFIX } from "./types.js"

/** The 21 variables of operate 0.10.0 (src/config/types.ts of its tag v0.10.0), in ENV order. */
const RELEASED = [
  "OPERATE_URL",
  "OPERATE_ENGINE",
  "OPERATE_PROFILE",
  "OPERATE_CONFIG",
  "OPERATE_OUTPUT",
  "OPERATE_TIMEOUT",
  "OPERATE_AUTH",
  "OPERATE_USERNAME",
  "OPERATE_PASSWORD",
  "OPERATE_OAUTH_ISSUER",
  "OPERATE_OAUTH_AUTHORIZATION_ENDPOINT",
  "OPERATE_OAUTH_TOKEN_ENDPOINT",
  "OPERATE_OAUTH_CLIENT_ID",
  "OPERATE_OAUTH_CLIENT_SECRET",
  "OPERATE_OAUTH_SCOPES",
  "OPERATE_OAUTH_AUDIENCE",
  "OPERATE_OAUTH_REDIRECT_PORT",
  "OPERATE_TOKEN",
  "OPERATE_TOKEN_COMMAND",
  "OPERATE_HEADERS",
  "OPERATE_READ_ONLY",
]

const PREFIX =
  "Warning: operate is now pulse-cli, and its old names stop working in the first release after 2027-01-31: "
const SUFFIX = ". See https://miragon.github.io/pulse/cli/installation#renamed-from-operate"

describe("the names of operate", () => {
  it("are spelled as operate released them", () => {
    expect(LEGACY_ENV_PREFIX).toBe("OPERATE_")
    expect(LEGACY_PROJECT_FILE).toBe(".operate.json")
    expect(LEGACY_CONFIG_DIRECTORY).toBe("operate")
    expect(LEGACY_PROGRAM).toBe("operate")
    expect(LEGACY_REMOVAL).toBe("the first release after 2027-01-31")
  })

  it("give way to PULSE_CLI_ names, never bare PULSE_ (PulseAudio's)", () => {
    expect(ENV_PREFIX).toBe("PULSE_CLI_")
    for (const name of Object.values(ENV)) expect(name.startsWith(ENV_PREFIX), name).toBe(true)
    expect(legacyVariable(ENV.oauthClientSecret)).toBe("OPERATE_OAUTH_CLIENT_SECRET")
  })
})

describe("withLegacyEnv", () => {
  it("maps exactly the released variables, in ENV order, and nothing for flavor", () => {
    const raw = Object.fromEntries(
      [...RELEASED, "OPERATE_PLATFORM", "OPERATE_FLAVOR", "OPERATE_IT_ENGINES"].map((name) => [
        name,
        `v-${name}`,
      ]),
    )
    const { env, uses } = withLegacyEnv(raw)
    expect(uses.map((use) => (use.kind === "variable" ? use.name : use.kind))).toEqual(RELEASED)
    expect(uses.every((use) => use.kind === "variable" && !use.ignored)).toBe(true)
    expect(env[ENV.flavor]).toBeUndefined()
    expect(env.PULSE_CLI_PLATFORM).toBeUndefined()
    expect(env[ENV.tokenCommand]).toBe("v-OPERATE_TOKEN_COMMAND")
  })

  it("reads an old variable as its new twin", () => {
    const { env, uses } = withLegacyEnv({ OPERATE_URL: "http://old" })
    expect(env[ENV.url]).toBe("http://old")
    expect(uses).toEqual([
      { kind: "variable", name: "OPERATE_URL", replacement: "PULSE_CLI_URL", ignored: false },
    ])
  })

  it("keeps the raw environment readable and unchanged", () => {
    const raw = { OPERATE_TOKEN: "t", CI_TOKEN: "c", HOME: "/h" }
    const { env } = withLegacyEnv(raw)
    expect([env.PULSE_CLI_TOKEN, env.OPERATE_TOKEN, env.CI_TOKEN, env.HOME]).toEqual([
      "t",
      "t",
      "c",
      "/h",
    ])
    expect(Object.keys(raw)).toEqual(["OPERATE_TOKEN", "CI_TOKEN", "HOME"])
    const unknown = { OPERATE_PLATFORM: "operaton", HOME: "/h" }
    expect(withLegacyEnv(unknown)).toEqual({ env: unknown, uses: [] })
    expect(withLegacyEnv(unknown).env).toBe(unknown)
  })

  it("ignores blank old values", () => {
    expect(withLegacyEnv({ OPERATE_URL: "", OPERATE_TOKEN: "  " })).toEqual({
      env: { OPERATE_URL: "", OPERATE_TOKEN: "  " },
      uses: [],
    })
  })

  it("reads no old variable once a new one is set: new wins, also for other names", () => {
    const raw = { PULSE_CLI_URL: "new", OPERATE_URL: "old", OPERATE_HEADERS: "X-A: 1" }
    const { env, uses } = withLegacyEnv(raw)
    expect(env).toBe(raw)
    expect(env[ENV.url]).toBe("new")
    expect(env[ENV.headers]).toBeUndefined()
    expect(uses).toEqual([
      { kind: "variable", name: "OPERATE_URL", replacement: "PULSE_CLI_URL", ignored: true },
      {
        kind: "variable",
        name: "OPERATE_HEADERS",
        replacement: "PULSE_CLI_HEADERS",
        ignored: true,
      },
    ])
  })

  it("counts a blank new variable and PULSE_CLI_FLAVOR as set", () => {
    const blank = withLegacyEnv({ PULSE_CLI_HEADERS: "", OPERATE_TOKEN: "t" })
    expect(blank.env[ENV.token]).toBeUndefined()
    expect(blank.uses).toMatchObject([{ name: "OPERATE_TOKEN", ignored: true }])
    const flavor = withLegacyEnv({ PULSE_CLI_FLAVOR: "operaton", OPERATE_URL: "http://old" })
    expect(flavor.env[ENV.url]).toBeUndefined()
    expect(flavor.uses).toMatchObject([{ name: "OPERATE_URL", ignored: true }])
  })

  it("prefers the new name, else a given old one, for every released variable", () => {
    const value = fc.option(fc.constantFrom("", " ", "a", "b c"), { nil: undefined })
    const pairs = fc.array(fc.tuple(value, value), {
      minLength: RELEASED.length,
      maxLength: RELEASED.length,
    })
    fc.assert(
      fc.property(pairs, (values) => {
        const names = RELEASED.map((old) => `${ENV_PREFIX}${old.slice(LEGACY_ENV_PREFIX.length)}`)
        const raw: Record<string, string | undefined> = {}
        values.forEach(([fresh, old], index) => {
          if (fresh !== undefined) raw[names[index]!] = fresh
          if (old !== undefined) raw[RELEASED[index]!] = old
        })
        const anyNew = names.some((name) => raw[name] !== undefined)
        const { env } = withLegacyEnv(raw)
        names.forEach((name, index) => {
          const old = raw[RELEASED[index]!]
          const given = old !== undefined && old.trim() !== "" ? old : undefined
          expect(env[name]).toBe(anyNew ? raw[name] : given)
        })
      }),
    )
  })
})

describe("isLegacyProgram", () => {
  it.each([
    "operate",
    "operate.exe",
    "OPERATE.EXE",
    "operate.cmd",
    "operate.ps1",
    "/usr/lib/node_modules/x/bin/operate.js",
    "operate.cjs",
    "operate.mjs",
    "/opt/homebrew/bin/operate",
    "C:\\x\\operate.exe",
  ])("knows %s", (invokedAs) => {
    expect(isLegacyProgram(invokedAs)).toBe(true)
  })

  it.each([
    "pulse-cli",
    "/x/dist/pulse-cli.js",
    "node",
    "",
    undefined,
    "operate-x",
    "xoperate",
    "/operate/pulse-cli",
    "operate.sh",
  ])("lets %s pass", (invokedAs) => {
    expect(isLegacyProgram(invokedAs)).toBe(false)
  })
})

describe("legacyWarning", () => {
  const variable: LegacyUse = {
    kind: "variable",
    name: "OPERATE_URL",
    replacement: "PULSE_CLI_URL",
    ignored: false,
  }
  const ignored: LegacyUse = {
    kind: "variable",
    name: "OPERATE_HEADERS",
    replacement: "PULSE_CLI_HEADERS",
    ignored: true,
  }
  const config: LegacyUse = {
    kind: "config-file",
    path: "/home/u/.config/operate/config.json",
    replacement: "/home/u/.config/pulse-cli/config.json",
  }
  const project: LegacyUse = {
    kind: "project-file",
    path: "/repo/.operate.json",
    replacement: ".pulse-cli.json",
  }
  const shadowed: LegacyUse = { ...project, shadowedBy: "/repo/.pulse-cli.json" }
  const of = (uses: readonly LegacyUse[]) =>
    legacyWarning(uses)?.slice(PREFIX.length, -SUFFIX.length)

  it("is no warning without old names", () => {
    expect(legacyWarning([])).toBeUndefined()
  })

  it("names each kind of use", () => {
    expect(of([LEGACY_PROGRAM_USE])).toBe("the command operate (now pulse-cli)")
    expect(of([variable])).toBe("OPERATE_URL (now PULSE_CLI_URL)")
    expect(of([ignored])).toBe(
      "OPERATE_HEADERS (ignored, since PULSE_CLI_ variables are set; now PULSE_CLI_HEADERS)",
    )
    expect(of([config])).toBe(
      "/home/u/.config/operate/config.json (now /home/u/.config/pulse-cli/config.json, which the next config edit writes)",
    )
    expect(of([project])).toBe("/repo/.operate.json (now .pulse-cli.json)")
    expect(of([shadowed])).toBe("/repo/.operate.json (ignored next to /repo/.pulse-cli.json)")
  })

  it("is one line in a fixed order, without duplicates, naming the removal and the docs", () => {
    const warning = legacyWarning([project, variable, config, LEGACY_PROGRAM_USE, variable])
    expect(warning).toBe(
      `${PREFIX}the command operate (now pulse-cli); OPERATE_URL (now PULSE_CLI_URL); /home/u/.config/operate/config.json (now /home/u/.config/pulse-cli/config.json, which the next config edit writes); /repo/.operate.json (now .pulse-cli.json)${SUFFIX}`,
    )
    expect(warning).not.toContain("\n")
    expect(warning).toContain(LEGACY_REMOVAL)
    expect(warning?.endsWith(LEGACY_DOCS)).toBe(true)
  })

  it("links a section of the docs that exists", () => {
    const page = readFileSync(
      new URL("../../../../docs/cli/installation.md", import.meta.url),
      "utf8",
    )
    expect(page).toContain("\n## Renamed from operate\n")
    expect(LEGACY_DOCS).toBe(
      "https://miragon.github.io/pulse/cli/installation#renamed-from-operate",
    )
  })
})

describe("the removal of operate's names", () => {
  it("is due before the first release after 2027-01-31", () => {
    const changelog = readFileSync(new URL("../../../../CHANGELOG.md", import.meta.url), "utf8")
    const latest = /^#{2,3} \[[^\]]+\]\([^)]*\) \((\d{4}-\d{2}-\d{2})\)$/m.exec(changelog)?.[1]
    expect(latest, "CHANGELOG.md names no release").toBeDefined()
    expect(
      latest! <= "2027-01-31",
      `release ${latest ?? ""} would still read operate's names: remove the compat layer (apps/cli/CLAUDE.md, "Names of operate")`,
    ).toBe(true)
  })
})
