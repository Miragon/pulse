/** unsetProfileKeys, showConfig and Basic auth in profiles (edit.ts). */

import { describe, expect, it } from "vitest"
import { frozen } from "../../test/support/config-edit.js"
import { failure } from "../../test/support/failure.js"
import { listProfiles, setProfile, showConfig, unsetProfileKeys } from "./edit.js"
import { parseConfigFile } from "./file.js"
import { resolveConfig } from "./resolve.js"
import type { ConfigFile } from "./types.js"

const TWO: ConfigFile = {
  defaultProfile: "dev",
  profiles: {
    dev: { url: "http://localhost:8080/engine-rest", readOnly: false },
    prod: {
      url: "https://prod/engine-rest",
      engine: "main",
      auth: { type: "none" },
      output: "json",
      timeout: 5000,
      headers: { "X-Tenant": "acme" },
      readOnly: true,
    },
  },
}

describe("unsetProfileKeys", () => {
  it("removes the given keys", () => {
    const result = unsetProfileKeys(TWO, "prod", ["engine", "headers", "readOnly"])
    expect(result).toEqual({
      defaultProfile: "dev",
      profiles: {
        dev: TWO.profiles.dev,
        prod: {
          url: "https://prod/engine-rest",
          auth: { type: "none" },
          output: "json",
          timeout: 5000,
        },
      },
    })
  })

  it("accepts kebab and singular spellings", () => {
    const result = unsetProfileKeys(TWO, "prod", ["read-only", "header"])
    expect(result.profiles.prod).not.toHaveProperty("readOnly")
    expect(result.profiles.prod).not.toHaveProperty("headers")
    expect(result.profiles.prod).toHaveProperty("url")
  })

  it("can remove every key", () => {
    const keys = ["url", "engine", "auth", "output", "timeout", "headers", "readOnly"]
    expect(unsetProfileKeys(TWO, "prod", keys).profiles.prod).toEqual({})
  })

  it("ignores keys the profile does not set", () => {
    expect(unsetProfileKeys(TWO, "dev", ["engine", "timeout"])).toEqual(TWO)
  })

  it("rejects unknown keys and lists the valid ones", () => {
    const error = failure(() => unsetProfileKeys(TWO, "prod", ["url", "user"]))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe('Unknown profile key "user"')
    expect(error.details.hint).toBe(
      "Valid keys: url, cockpitUrl, engine, flavor, auth, output, timeout, headers, readOnly; bearer token: token, tokenEnv.",
    )
  })

  it("drops an auth object that has nothing left and ignores bearer keys without auth", () => {
    expect(
      unsetProfileKeys({ profiles: { p: { auth: { tokenEnv: "T" } } } }, "p", ["tokenEnv"]).profiles
        .p,
    ).toEqual({})
    expect(unsetProfileKeys(TWO, "dev", ["token"])).toEqual(TWO)
  })

  it("rejects a missing profile with the known profiles as hint", () => {
    const error = failure(() => unsetProfileKeys(TWO, "qa", ["url"]))
    expect(error.message).toBe('Profile "qa" does not exist')
    expect(error.details.hint).toBe(
      "Known profiles: dev, prod. Create it with `pulse-cli config set qa --url <url>`.",
    )
    expect(failure(() => unsetProfileKeys(undefined, "qa", ["url"])).details.hint).toBe(
      "Create it with `pulse-cli config set qa --url <url>`.",
    )
  })

  it("does not modify its input", () => {
    const input = frozen(TWO)
    unsetProfileKeys(input, "prod", ["url"])
    expect(input).toEqual(TWO)
  })
})

describe("showConfig", () => {
  it("shows every effective value with its source", () => {
    const resolved = resolveConfig(
      { output: "json", headers: ["X-Flag: 1"] },
      { PULSE_CLI_TIMEOUT: "1000" },
      TWO,
    )
    expect(showConfig(resolved, "/home/me/.config/pulse-cli/config.json")).toEqual({
      configFile: "/home/me/.config/pulse-cli/config.json",
      projectFile: null,
      profile: "dev",
      profileFile: "/home/me/.config/pulse-cli/config.json",
      values: {
        url: { value: "http://localhost:8080/engine-rest", source: "profile" },
        cockpitUrl: { value: null, source: "default" },
        engine: { value: null, source: "default" },
        flavor: { value: "camunda7", source: "default" },
        auth: { value: "none", source: "default" },
        username: { value: null, source: "default" },
        password: { value: null, source: "default" },
        output: { value: "json", source: "flag" },
        timeout: { value: 1000, source: "env" },
        headers: { value: { "X-Flag": "1" }, source: "flag" },
        readOnly: { value: false, source: "profile" },
      },
    })
  })

  it("shows the cockpit URL of the profile", () => {
    const file: ConfigFile = { profiles: { p: { cockpitUrl: "http://ops/cockpit" } } }
    const view = showConfig(resolveConfig({ profile: "p" }, {}, file), "c.json")
    expect(view.values.cockpitUrl).toEqual({ value: "http://ops/cockpit", source: "profile" })
  })

  it("uses null for values that are not set", () => {
    const view = showConfig(resolveConfig({}, {}, undefined), "c.json")
    expect(view.profile).toBeNull()
    expect(view.values.engine).toEqual({ value: null, source: "default" })
    expect(view.values.output).toEqual({ value: null, source: "default" })
  })

  it("shows the selected engine and profile", () => {
    const view = showConfig(resolveConfig({ profile: "prod" }, {}, TWO), "c.json")
    expect(view.profile).toBe("prod")
    expect(view.values.engine).toEqual({ value: "main", source: "profile" })
    expect(view.values.headers).toEqual({ value: { "X-Tenant": "acme" }, source: "profile" })
  })
})

describe("Basic auth in profiles", () => {
  it("stores type, username and the password variable", () => {
    const result = setProfile(TWO, "dev", {
      auth: "basic",
      authUser: "demo",
      authPasswordEnv: "CAMUNDA_PASSWORD",
    })
    expect(result.profiles.dev).toEqual({
      url: "http://localhost:8080/engine-rest",
      auth: { type: "basic", username: "demo", passwordEnv: "CAMUNDA_PASSWORD" },
      readOnly: false,
    })
    expect(parseConfigFile(JSON.stringify(result), "c.json")).toEqual(result)
  })

  it("switches the stored type none to basic when only credentials are given", () => {
    const result = setProfile(TWO, "prod", { authUser: "demo", authPassword: "pw" })
    expect(result.profiles.prod?.auth).toEqual({
      type: "basic",
      username: "demo",
      password: "pw",
    })
  })

  it("keeps the auth object when other values change", () => {
    const stored = setProfile(undefined, "p", { authUser: "demo", authPasswordEnv: "PW" })
    expect(setProfile(stored, "p", { timeout: 5 }).profiles.p?.auth).toEqual({
      username: "demo",
      passwordEnv: "PW",
    })
  })

  it("removes every auth setting with unset auth", () => {
    const stored = setProfile(undefined, "p", { auth: "basic", authUser: "demo", url: "http://x" })
    expect(unsetProfileKeys(stored, "p", ["auth"]).profiles.p).toEqual({ url: "http://x" })
  })

  it("lists a profile with a username as basic", () => {
    const file: ConfigFile = {
      profiles: {
        implied: { auth: { username: "demo" } },
        explicit: { auth: { type: "none", username: "demo" } },
        empty: { auth: {} },
      },
    }
    expect(listProfiles(file).map(({ name, auth }) => [name, auth])).toEqual([
      ["empty", null],
      ["explicit", "none"],
      ["implied", "basic"],
    ])
  })

  it("shows username and password with their sources", () => {
    const file: ConfigFile = {
      defaultProfile: "p",
      profiles: { p: { auth: { username: "demo", passwordEnv: "PW" } } },
    }
    const view = showConfig(resolveConfig({}, { PW: "s3cret" }, file), "c.json")
    expect(view.values.auth).toEqual({ value: "basic", source: "profile" })
    expect(view.values.username).toEqual({ value: "demo", source: "profile" })
    expect(view.values.password).toEqual({ value: "s3cret", source: "profile" })
    const fromEnv = showConfig(
      resolveConfig({ authUser: "cli" }, { PULSE_CLI_PASSWORD: "x", PW: "y" }, file),
      "c.json",
    )
    expect(fromEnv.values.username).toEqual({ value: "cli", source: "flag" })
    expect(fromEnv.values.password).toEqual({ value: "x", source: "env" })
  })
})
