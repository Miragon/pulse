/**
 * A URL without `--profile`, `--url` or PULSE_CLI_URL, selects no profile (resolve.ts): nothing of
 * the profile the CLI would select otherwise applies (PULSE_CLI_PROFILE, a defaultProfile), a
 * profile it could not use fails nothing, and the environment's own settings still apply.
 * `--profile p` with PULSE_CLI_URL stays per value, with a `--url` of the profile's own origin too
 * (url-beside-profile.test.ts refuses another one), and a blank one is none.
 */

import { describe, expect, it } from "vitest"
import { failure } from "../../test/support/failure.js"
import { resolveConfig, selectProfile } from "./resolve.js"
import type { LoadedConfig, Profile } from "./types.js"

const URL = "http://127.0.0.1:8941/engine-rest"
const PROFILE_URL = "https://orders.example.com/engine-rest"
/** Another URL of the profile's origin, spelled as the URL API normalises it away. */
const SAME_ORIGIN = "HTTPS://Orders.Example.com:443/v2/engine-rest"

const ORDERS: Profile = {
  url: PROFILE_URL,
  cockpitUrl: "https://orders.example.com/operaton/app/cockpit/default",
  engine: "orders",
  flavor: "operaton",
  output: "table",
  timeout: 3000,
  headers: { Authorization: "Bearer profile-token", "X-Api-Key": "profile-key" },
  readOnly: true,
}
const BASIC: Profile = {
  url: PROFILE_URL,
  auth: { type: "basic", username: "demo", passwordEnv: "ORDERS_PASSWORD" },
}

const FILE: LoadedConfig = {
  defaultProfile: "orders",
  profiles: { orders: ORDERS, basic: BASIC, broken: {} },
  refused: { broken: [{ code: "unknown-key", key: "flavour" }] },
}
const ENV = { ORDERS_PASSWORD: "profile-password" }

/** What a command resolves without any profile, its URL from the flag. */
const BARE = {
  url: URL,
  flavor: "camunda7",
  auth: { type: "none" },
  timeoutMs: 30000,
  headers: {},
  readOnly: false,
  sources: {
    url: "flag",
    engine: "default",
    flavor: "default",
    auth: "default",
    output: "default",
    timeout: "default",
    headers: "default",
    readOnly: "default",
  },
}
const LEFT_OUT = "--url without --profile selects no profile"

/** BARE with why no profile applies, also the reason no credentials went (the hint of a 401). */
function leftOut(what: string) {
  const noProfile = `${LEFT_OUT}, so ${what} does not apply`
  return { ...BARE, auth: { type: "none", off: noProfile }, noProfile }
}

describe("a --url without --profile", () => {
  it("takes nothing of the default profile: no headers, engine, flavor, timeout or read-only", () => {
    expect(resolveConfig({ url: URL }, ENV, FILE)).toEqual(
      leftOut("the default profile of the config file"),
    )
    expect(selectProfile({ url: ` ${URL} ` }, ENV, FILE)).toEqual({})
  })

  it("takes nothing of the profile PULSE_CLI_PROFILE names, its Basic login neither", () => {
    expect(resolveConfig({ url: URL }, { ...ENV, PULSE_CLI_PROFILE: "basic" }, FILE)).toEqual(
      leftOut("PULSE_CLI_PROFILE"),
    )
  })

  it("fails on no profile it would not use: a missing or refused one, a broken default", () => {
    for (const name of ["gone", "broken"]) {
      const env = { PULSE_CLI_PROFILE: name }
      expect(resolveConfig({ url: URL }, env, FILE).url).toBe(URL)
      expect(failure(() => resolveConfig({}, env, FILE)).code).toBe("CONFIG")
    }
    const dangling: LoadedConfig = {
      profiles: { orders: ORDERS },
      defaultProblem: { problem: { code: "invalid-name", key: "defaultProfile" } },
    }
    expect(resolveConfig({ url: URL }, {}, dangling)).toEqual(
      leftOut("the default profile of the config file"),
    )
    expect(failure(() => resolveConfig({}, {}, dangling)).message).toMatch(/defaultProfile/)
  })

  it("names the project file whose default profile it leaves out, and nothing without one", () => {
    const source = { path: "/repo/.pulse.json", directory: "/repo" }
    const project: LoadedConfig = {
      ...FILE,
      project: { source, profiles: ["orders"], defaultProfile: true },
    }
    expect(resolveConfig({ url: URL }, ENV, project).noProfile).toBe(
      `${LEFT_OUT}, so the default profile of the project file /repo/.pulse.json does not apply`,
    )
    expect(resolveConfig({ url: URL }, {}, undefined)).toEqual({ ...BARE, noProfile: LEFT_OUT })
    expect(resolveConfig({ url: URL }, {}, { profiles: { orders: ORDERS } }).noProfile).toBe(
      LEFT_OUT,
    )
  })

  it("keeps the environment's own settings: headers, auth, engine, timeout, read-only", () => {
    const env = {
      PULSE_CLI_PROFILE: "orders",
      PULSE_CLI_HEADERS: "X-Shell: s",
      PULSE_CLI_AUTH: "basic",
      PULSE_CLI_USERNAME: "shell",
      PULSE_CLI_PASSWORD: "shell-password",
      PULSE_CLI_ENGINE: "shell-engine",
      PULSE_CLI_TIMEOUT: "2000",
      PULSE_CLI_READ_ONLY: "true",
    }
    expect(resolveConfig({ url: URL }, env, FILE)).toMatchObject({
      url: URL,
      engine: "shell-engine",
      auth: { type: "basic", username: "shell", password: "shell-password" },
      timeoutMs: 2000,
      headers: { "X-Shell": "s" },
      readOnly: true,
      sources: { auth: "env", engine: "env", headers: "env", timeout: "env", readOnly: "env" },
    })
    // --auth none beats PULSE_CLI_AUTH, as the editors' command for their default engine needs; its
    // reason stays the one a 401 names
    expect(resolveConfig({ url: URL, auth: "none" }, env, FILE).auth).toEqual({
      type: "none",
      off: "Basic auth is switched off by --auth none",
    })
  })
})

describe("beside --profile or without a flag", () => {
  it("--profile p --url X of the origin of p replaces the URL of p only", () => {
    const resolved = resolveConfig({ profile: "orders", url: SAME_ORIGIN }, ENV, FILE)
    expect(resolved).toMatchObject({
      profile: "orders",
      url: SAME_ORIGIN,
      engine: "orders",
      flavor: "operaton",
      cockpitUrl: ORDERS.cockpitUrl,
      timeoutMs: 3000,
      headers: ORDERS.headers,
      readOnly: true,
      sources: { url: "flag", engine: "profile", headers: "profile", readOnly: "profile" },
    })
    expect(resolved.noProfile).toBeUndefined()
    const basic = resolveConfig({ profile: "basic", url: SAME_ORIGIN }, ENV, FILE).auth
    expect(basic).toMatchObject({ type: "basic", username: "demo", password: "profile-password" })
  })

  it("a blank --url is no --url", () => {
    expect(resolveConfig({ url: " " }, ENV, FILE)).toMatchObject({
      profile: "orders",
      url: PROFILE_URL,
    })
  })
})

describe("PULSE_CLI_URL without --profile, as a --url", () => {
  const env = { ...ENV, PULSE_CLI_URL: URL }

  /** leftOut, the URL from PULSE_CLI_URL, which the sentence names. */
  function fromEnv(what: string) {
    const noProfile = `PULSE_CLI_URL without --profile selects no profile, so ${what} does not apply`
    const sources = { ...BARE.sources, url: "env" }
    return { ...BARE, auth: { type: "none", off: noProfile }, noProfile, sources }
  }

  it("takes nothing of the default profile, nor of the one PULSE_CLI_PROFILE names", () => {
    expect(resolveConfig({}, env, FILE)).toEqual(fromEnv("the default profile of the config file"))
    expect(selectProfile({}, { PULSE_CLI_URL: ` ${URL} ` }, FILE)).toEqual({})
    expect(resolveConfig({}, { ...env, PULSE_CLI_PROFILE: "basic" }, FILE)).toEqual(
      fromEnv("PULSE_CLI_PROFILE"),
    )
  })

  it("fails on no profile it would not use: a missing or refused one, a broken default", () => {
    for (const name of ["gone", "broken"]) {
      expect(resolveConfig({}, { ...env, PULSE_CLI_PROFILE: name }, FILE).url).toBe(URL)
    }
    const dangling: LoadedConfig = {
      profiles: { orders: ORDERS },
      defaultProblem: { problem: { code: "invalid-name", key: "defaultProfile" } },
    }
    expect(resolveConfig({}, env, dangling)).toEqual(
      fromEnv("the default profile of the config file"),
    )
    expect(resolveConfig({}, { PULSE_CLI_URL: URL }, undefined)).toEqual({
      ...BARE,
      noProfile: "PULSE_CLI_URL without --profile selects no profile",
      sources: { ...BARE.sources, url: "env" },
    })
  })

  it("keeps the environment's own headers, never the profile's", () => {
    const resolved = resolveConfig({}, { ...env, PULSE_CLI_HEADERS: "X-Shell: s" }, FILE)
    expect(resolved.headers).toEqual({ "X-Shell": "s" })
    expect(resolved.sources.headers).toBe("env")
  })

  it("beside --profile p replaces the URL of p only; beside --url the flag gives the URL", () => {
    const resolved = resolveConfig({ profile: "orders" }, env, FILE)
    expect(resolved).toMatchObject({
      profile: "orders",
      url: URL,
      engine: "orders",
      headers: ORDERS.headers,
      readOnly: true,
      sources: { url: "env", engine: "profile", headers: "profile", readOnly: "profile" },
    })
    expect(resolved.noProfile).toBeUndefined()
    const flag = resolveConfig({ url: PROFILE_URL }, env, FILE)
    expect(flag).toMatchObject({ url: PROFILE_URL, sources: { url: "flag" } })
    expect(flag.noProfile).toBe(
      `${LEFT_OUT}, so the default profile of the config file does not apply`,
    )
  })

  it("an empty or blank PULSE_CLI_URL is none: the default profile applies", () => {
    for (const blank of ["", " "]) {
      const resolved = resolveConfig({}, { ...ENV, PULSE_CLI_URL: blank }, FILE)
      expect(resolved).toMatchObject({
        profile: "orders",
        url: PROFILE_URL,
        headers: ORDERS.headers,
      })
      expect(resolved.noProfile).toBeUndefined()
    }
  })
})
