import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  configOrigin,
  loginKeyOf,
  loginProfiles,
  originOf,
  originPath,
  sameLoginKey,
} from "./login-key.js"
import type { LoadedConfig, LoginKey, ProfileAuth } from "./types.js"

const ISSUER = "https://login.example.com/realms/camunda"
const USER = "config:/home/me/.config/pulse-cli/config.json"
const REPO = "repository:/work/shop/.git"
const OAUTH: ProfileAuth = { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" }

describe("loginKeyOf", () => {
  it("keys on the origin and the stored issuer, client, audience and scopes", () => {
    expect(loginKeyOf(USER, OAUTH)).toEqual({
      origin: USER,
      issuer: ISSUER,
      tokenEndpoint: null,
      clientId: "pulse-cli",
      audience: null,
      scopes: ["offline_access", "openid"],
    })
    const stored = { ...OAUTH, audience: "engine-rest", scopes: ["openid", "email", "openid"] }
    expect(loginKeyOf(REPO, stored)).toMatchObject({
      origin: REPO,
      audience: "engine-rest",
      scopes: ["email", "openid"],
    })
    expect(loginKeyOf(USER, { ...OAUTH, scopes: [] }).scopes).toEqual([])
  })

  it("keeps the token endpoint only with explicit endpoints, like the identity of a login", () => {
    const token = `${ISSUER}/token`
    expect(loginKeyOf(USER, { ...OAUTH, tokenEndpoint: token }).tokenEndpoint).toBeNull()
    expect(
      loginKeyOf(USER, { ...OAUTH, authorizationEndpoint: `${ISSUER}/auth`, tokenEndpoint: token })
        .tokenEndpoint,
    ).toBe(token)
    expect(loginKeyOf(USER, { authorizationEndpoint: `${ISSUER}/auth` }).tokenEndpoint).toBeNull()
  })

  it("keys a profile without OAuth settings on nothing but its origin and the default scopes", () => {
    const empty = {
      origin: USER,
      issuer: null,
      tokenEndpoint: null,
      clientId: null,
      audience: null,
      scopes: ["offline_access", "openid"],
    }
    expect(loginKeyOf(USER, undefined)).toEqual(empty)
    expect(loginKeyOf(USER, { type: "basic", username: "u" })).toEqual(empty)
  })

  it("gives a profile that stores no OAuth type a login of its own: its name", () => {
    expect(loginKeyOf(USER, { type: "basic", username: "u" }, "plain")).toMatchObject({
      origin: USER,
      profile: "plain",
      issuer: null,
    })
    expect(loginKeyOf(USER, undefined, "none").profile).toBe("none")
    expect(loginKeyOf(USER, OAUTH, "orders")).not.toHaveProperty("profile")
    const plain = loginKeyOf(USER, { issuer: ISSUER, clientId: "pulse-cli" }, "plain")
    expect(sameLoginKey(plain, loginKeyOf(USER, OAUTH, "orders"))).toBe(false)
    expect(
      sameLoginKey(plain, loginKeyOf(USER, { issuer: ISSUER, clientId: "pulse-cli" }, "other")),
    ).toBe(false)
  })

  it("ignores what does not decide the login: secrets, redirect port", () => {
    const variants: ProfileAuth[] = [
      { ...OAUTH, clientSecretEnv: "SECRET" },
      { ...OAUTH, clientSecret: "s" },
      { ...OAUTH, redirectPort: 8765 },
    ]
    for (const auth of variants) {
      expect(sameLoginKey(loginKeyOf(USER, auth), loginKeyOf(USER, OAUTH))).toBe(true)
    }
  })
})

describe("sameLoginKey", () => {
  const key = loginKeyOf(USER, OAUTH)
  it("compares every field", () => {
    const changes: Partial<LoginKey>[] = [
      { origin: REPO },
      { issuer: null },
      { tokenEndpoint: `${ISSUER}/token` },
      { clientId: "other" },
      { audience: "engine-rest" },
      { scopes: ["openid"] },
    ]
    expect(sameLoginKey(key, { ...key })).toBe(true)
    for (const change of changes) expect(sameLoginKey(key, { ...key, ...change })).toBe(false)
  })

  it("is true exactly for keys of equal JSON (the cache file name)", () => {
    const keys = fc.record({
      origin: fc.constantFrom(USER, REPO),
      issuer: fc.constantFrom(ISSUER, null),
      tokenEndpoint: fc.constantFrom(`${ISSUER}/token`, null),
      clientId: fc.constantFrom("a", "b", null),
      audience: fc.constantFrom("x", null),
      scopes: fc.subarray(["email", "offline_access", "openid"]),
    })
    fc.assert(
      fc.property(keys, keys, (left, right) => {
        expect(sameLoginKey(left, right)).toBe(JSON.stringify(left) === JSON.stringify(right))
      }),
    )
  })
})

describe("origins", () => {
  it("names a config file by its absolute path, on Windows without case", () => {
    expect(configOrigin("/home/me/.config/pulse-cli/config.json", "/x", "linux")).toBe(USER)
    expect(configOrigin("ci/operate.json", "/work/shop", "linux")).toBe(
      "config:/work/shop/ci/operate.json",
    )
    expect(configOrigin("..\\Operate.JSON", "C:\\Work\\Shop", "win32")).toBe(
      "config:c:\\work\\operate.json",
    )
    expect(originPath("/a/./b/../c", "/", "linux")).toBe("/a/c")
  })

  it("are the project file's for its profiles and the config file's for the others", () => {
    const file: LoadedConfig = {
      origin: USER,
      profiles: { mine: {}, svc: {} },
      project: {
        source: { path: "/work/shop/.pulse-cli.json", directory: "/work/shop", origin: REPO },
        profiles: ["svc"],
        defaultProfile: false,
      },
    }
    expect(originOf(file, "svc")).toBe(REPO)
    expect(originOf(file, "mine")).toBe(USER)
    expect(originOf({ profiles: { mine: {} } }, "mine")).toBeUndefined()
  })
})

describe("loginProfiles", () => {
  const file: LoadedConfig = {
    origin: USER,
    profiles: {
      orders: { auth: OAUTH },
      mine: { auth: OAUTH },
      billing: { auth: OAUTH },
      audience: { auth: { ...OAUTH, audience: "engine-rest" } },
      basic: { auth: { type: "basic", username: "u" } },
      none: {},
    },
    project: {
      source: { path: "/work/shop/.pulse-cli.json", directory: "/work/shop", origin: REPO },
      profiles: ["orders", "billing", "audience"],
      defaultProfile: false,
    },
  }

  it("lists the OAuth profiles of the same origin with the same stored settings, in file order", () => {
    expect(loginProfiles(file, loginKeyOf(REPO, OAUTH))).toEqual(["orders", "billing"])
    expect(loginProfiles(file, loginKeyOf(USER, OAUTH))).toEqual(["mine"])
    expect(loginProfiles(file, loginKeyOf(REPO, { ...OAUTH, audience: "engine-rest" }))).toEqual([
      "audience",
    ])
  })

  it("lists no profile without OAuth, none of an unknown origin and none without a file", () => {
    expect(loginProfiles(file, loginKeyOf(USER, undefined))).toEqual([])
    expect(loginProfiles({ profiles: { a: { auth: OAUTH } } }, loginKeyOf(USER, OAUTH))).toEqual([])
    expect(loginProfiles(undefined, loginKeyOf(USER, OAUTH))).toEqual([])
  })
})
