import { describe, expect, it } from "vitest"
import { PulseCliError } from "../errors.js"
import {
  changedAuth,
  replacedFamily,
  settingsFamily,
  storedFamily,
  usesCredentials,
} from "./auth-edit.js"
import { bearerUnsetKeys, changedBearerKeys, hasBearerOptions } from "./bearer-edit.js"
import { listProfiles, setProfile, showConfig, unsetProfileKeys } from "./edit.js"
import { resolveConfig } from "./resolve.js"
import type { ConfigFile, ProfileAuth } from "./types.js"

function failure(action: () => unknown): PulseCliError {
  try {
    action()
  } catch (error) {
    if (error instanceof PulseCliError) return error
    throw error
  }
  throw new Error("expected an PulseCliError")
}

function file(auth: ProfileAuth, headers?: Record<string, string>): ConfigFile {
  return {
    defaultProfile: "p",
    profiles: { p: { url: "http://x", auth, ...(headers === undefined ? {} : { headers }) } },
  }
}

describe("changedBearerKeys", () => {
  it("stores the variable name or the normalized token, each replacing the other", () => {
    expect(changedBearerKeys({ token: "old" }, { authTokenEnv: " CI_TOKEN " })).toEqual({
      tokenEnv: "CI_TOKEN",
    })
    expect(changedBearerKeys({ tokenEnv: "X" }, { authToken: "Bearer abc.def" })).toEqual({
      token: "abc.def",
    })
    expect(changedBearerKeys({ tokenEnv: "X" }, {})).toEqual({ tokenEnv: "X" })
    expect(changedBearerKeys(undefined, {})).toEqual({})
  })

  it("refuses both options and invalid values without repeating them", () => {
    const both = failure(() => changedBearerKeys(undefined, { authTokenEnv: "X", authToken: "t" }))
    expect(both.message).toBe("--auth-token-env and --auth-token-stdin exclude each other")
    expect(both.details.hint).toBe(
      "Store the name of the environment variable that holds the token (recommended), or the token itself.",
    )
    const name = failure(() => changedBearerKeys(undefined, { authTokenEnv: "eyJ.abc.def" }))
    expect(name.message).toBe(
      "Invalid --auth-token-env: expected the name of an environment variable",
    )
    const token = failure(() => changedBearerKeys(undefined, { authToken: "a b" }))
    expect(token.message).toBe(
      "The bearer token from --auth-token-stdin has characters a bearer token cannot have (RFC 6750)",
    )
  })

  it("tells whether an option was given", () => {
    expect(hasBearerOptions({})).toBe(false)
    expect(hasBearerOptions({ authTokenEnv: "X" })).toBe(true)
    expect(hasBearerOptions({ authToken: "t" })).toBe(true)
  })
})

describe("changedAuth with bearer token options", () => {
  it("selects type bearer for bearer options without --auth", () => {
    expect(changedAuth(undefined, { authTokenEnv: "CI_TOKEN" })).toEqual({
      type: "bearer",
      tokenEnv: "CI_TOKEN",
    })
    expect(changedAuth({ type: "none" }, { authToken: "abc" })).toEqual({
      type: "bearer",
      token: "abc",
    })
  })

  it("keeps a token prepared with --auth none switched off", () => {
    expect(changedAuth(undefined, { auth: "none", authTokenEnv: "CI_TOKEN" })).toEqual({
      type: "none",
      tokenEnv: "CI_TOKEN",
    })
  })

  it("refuses bearer options next to the options or the type of another family", () => {
    expect(
      failure(() => changedAuth(undefined, { authTokenEnv: "X", authUser: "u" })).message,
    ).toBe("Basic auth options and bearer token options exclude each other")
    expect(
      failure(() => changedAuth(undefined, { authToken: "t", oauthClientId: "c" })).message,
    ).toBe("OAuth options and bearer token options exclude each other")
    expect(
      failure(() => changedAuth(undefined, { auth: "basic", authTokenEnv: "X" })).message,
    ).toBe("Bearer token options need --auth bearer, not --auth basic")
    expect(failure(() => changedAuth(undefined, { auth: "bearer", authUser: "u" })).message).toBe(
      "Basic auth options need --auth basic, not --auth bearer",
    )
    expect(
      failure(() => changedAuth(undefined, { auth: "bearer", oauthIssuer: "https://x" })).message,
    ).toBe("OAuth options need --auth oauth, not --auth bearer")
  })

  it("drops the keys of the other families", () => {
    const basic: ProfileAuth = { type: "basic", username: "u", passwordEnv: "PW" }
    expect(changedAuth(basic, { authTokenEnv: "X" })).toEqual({ type: "bearer", tokenEnv: "X" })
    expect(changedAuth(basic, { auth: "bearer" })).toEqual({ type: "bearer" })
    const oauth: ProfileAuth = { type: "oauth", issuer: "https://x", clientId: "c" }
    expect(changedAuth(oauth, { authToken: "t" })).toEqual({ type: "bearer", token: "t" })
    const bearer: ProfileAuth = { type: "bearer", tokenEnv: "X" }
    expect(changedAuth(bearer, { authUser: "u" })).toEqual({ type: "basic", username: "u" })
    expect(changedAuth(bearer, { oauthClientId: "c" })).toEqual({ type: "oauth", clientId: "c" })
    // --auth none alone keeps everything
    expect(changedAuth(bearer, { auth: "none" })).toEqual({ type: "none", tokenEnv: "X" })
  })

  it("knows which family was replaced and which replaces it", () => {
    expect(replacedFamily({ username: "u" }, { type: "bearer", tokenEnv: "X" })).toBe("basic")
    expect(replacedFamily({ type: "bearer", token: "t" }, { type: "oauth", clientId: "c" })).toBe(
      "bearer",
    )
    expect(replacedFamily({ type: "bearer", token: "t" }, { type: "none", token: "t" })).toBe(
      undefined,
    )
    expect(settingsFamily({ type: "none", tokenEnv: "X" })).toBe("bearer")
    expect(settingsFamily({ type: "none" })).toBeUndefined()
    expect(storedFamily({ type: "none", tokenEnv: "X" })).toBeUndefined()
    expect(storedFamily({ type: "bearer" })).toBe("bearer")
    expect(usesCredentials({ type: "bearer" })).toBe(true)
    expect(usesCredentials({ type: "none", token: "t" })).toBe(false)
  })
})

describe("setProfile with a bearer token", () => {
  it("replaces a stored Authorization header (the upgrade path from bearer headers)", () => {
    const before = file({ type: "none" }, { Authorization: "Bearer x", "X-Tenant": "a" })
    expect(setProfile(before, "p", { authTokenEnv: "CI_TOKEN" }).profiles.p).toEqual({
      url: "http://x",
      auth: { type: "bearer", tokenEnv: "CI_TOKEN" },
      headers: { "X-Tenant": "a" },
    })
  })

  it("refuses a header for a bearer profile, naming bearer auth", () => {
    const error = failure(() =>
      setProfile(file({ type: "bearer", tokenEnv: "X" }), "p", {
        headers: ["Authorization: Bearer y"],
      }),
    )
    expect(error.message).toBe(
      'Profile "p" would have both bearer auth and an Authorization header',
    )
    expect(error.details.hint).toBe(
      "Keep one: bearer auth options replace a stored Authorization header (`pulse-cli config set p --auth bearer`); --auth none switches bearer auth off and keeps the header (`pulse-cli config set p --auth none -H 'Authorization: ...'`).",
    )
  })
})

describe("unsetProfileKeys with a bearer token", () => {
  it("removes the token in either form, also with the auth. prefix", () => {
    for (const key of ["token", "tokenEnv", "auth.token", "auth.tokenEnv"]) {
      expect(
        unsetProfileKeys(file({ type: "bearer", tokenEnv: "X" }), "p", [key]).profiles.p,
      ).toEqual({ url: "http://x", auth: { type: "bearer" } })
      expect(unsetProfileKeys(file({ type: "bearer", token: "t" }), "p", [key]).profiles.p).toEqual(
        {
          url: "http://x",
          auth: { type: "bearer" },
        },
      )
    }
    expect(unsetProfileKeys(file({ token: "t" }), "p", ["token"]).profiles.p).toEqual({
      url: "http://x",
    })
    expect(bearerUnsetKeys("url")).toBeUndefined()
  })
})

describe("listProfiles and showConfig with a bearer token", () => {
  it("lists the type", () => {
    expect(listProfiles(file({ type: "bearer", tokenEnv: "X" }))[0]?.auth).toBe("bearer")
  })

  it("shows the token with its source, the credentials of other types null", () => {
    const config = resolveConfig(
      {},
      { CI_TOKEN: "abc" },
      file({ type: "bearer", tokenEnv: "CI_TOKEN" }),
    )
    const view = showConfig(config, "/c.json")
    expect(view.values.auth).toEqual({ value: "bearer", source: "profile" })
    expect(view.values.token).toEqual({ value: "abc", source: "profile" })
    expect(view.values.username).toEqual({ value: null, source: "default" })
    expect(Object.keys(view.values)).toEqual([
      "url",
      "cockpitUrl",
      "engine",
      "flavor",
      "auth",
      "username",
      "password",
      "token",
      "output",
      "timeout",
      "headers",
      "readOnly",
    ])
  })

  it("shows a token the type does not use, saying why", () => {
    const config = resolveConfig(
      { auth: "basic", authUser: "u" },
      { PULSE_CLI_PASSWORD: "pw", PULSE_CLI_TOKEN: "tok" },
      undefined,
    )
    expect(showConfig(config, "/c.json").values.token).toEqual({
      value: "tok",
      source: "env",
      unused: "Basic auth is selected by --auth basic",
    })
    expect(showConfig(resolveConfig({}, {}, undefined), "/c.json").values.token).toBeUndefined()
  })
})
