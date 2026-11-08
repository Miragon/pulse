import { describe, expect, it } from "vitest"
import { isHeaderName, isHeaderValue, isSecretHeader } from "./headers.js"
import {
  ENV_NAME,
  ENVIRONMENT_ID,
  isConventionalVariable,
  isKeyLike,
  PROFILE_NAME,
} from "./syntax.js"

describe("names", () => {
  it("takes letters, digits, dots, underscores and dashes for a profile, digits alone too", () => {
    for (const name of ["local", "prod-eu", "dev.sso", "a_b", "10", "A1"]) {
      expect(PROFILE_NAME.test(name), name).toBe(true)
    }
    for (const name of ["", "-a", ".a", "_a", "a b", "a/b", "ä"]) {
      expect(PROFILE_NAME.test(name), name).toBe(false)
    }
  })

  it("takes an environment id in lower case, digits alone too", () => {
    expect(["prod-eu", "1", "a1-b"].every((id) => ENVIRONMENT_ID.test(id))).toBe(true)
    expect(["Prod", "-a", "a_b", ""].some((id) => ENVIRONMENT_ID.test(id))).toBe(false)
  })

  it("takes a portable variable name", () => {
    expect(["ENGINE_SECRET_X", "_x", "a1"].every((name) => ENV_NAME.test(name))).toBe(true)
    expect(["1PW", "A-B", "A B", ""].some((name) => ENV_NAME.test(name))).toBe(false)
  })
})

describe("isKeyLike", () => {
  it("names a key of up to 40 characters that starts with a letter, or $schema", () => {
    for (const key of ["colour", "readOnyl", "$schema", "X-Api-Key", `a${"b".repeat(39)}`]) {
      expect(isKeyLike(key), key).toBe(true)
    }
    for (const key of ["", "1a", "a b", "a.b", "pa$$word", `a${"b".repeat(40)}`]) {
      expect(isKeyLike(key), key).toBe(false)
    }
  })
})

describe("isConventionalVariable", () => {
  it("is true for upper case names with words of at most 24 characters", () => {
    expect(isConventionalVariable("ENGINE_SECRET_PROD_PASSWORD")).toBe(true)
    expect(isConventionalVariable(`_${"A".repeat(24)}`)).toBe(true)
  })

  it("is false for what looks like a secret: lower case, long runs, too long", () => {
    expect(isConventionalVariable("ghp_16C7e42F292c6912E7710c838347Ae178B4a")).toBe(false)
    expect(isConventionalVariable("A".repeat(25))).toBe(false)
    expect(isConventionalVariable(`A${"_B".repeat(32)}`)).toBe(false)
    expect(isConventionalVariable("hunter2")).toBe(false)
  })
})

describe("headers", () => {
  it("takes an HTTP token for a name, but no header the client manages", () => {
    expect(isHeaderName("X-Tenant-Id")).toBe(true)
    expect(isHeaderName("!#$%&'*+.^_`|~")).toBe(true)
    for (const name of ["Bad Name", "", "Content-Length", "upgrade", "Keep-Alive"]) {
      expect(isHeaderName(name), name).toBe(false)
    }
  })

  it("takes a Latin-1 value with tabs, without other control characters", () => {
    expect(isHeaderValue("tab\there é ÿ")).toBe(true)
    for (const value of ["line\nbreak", "nul\u0000", "del\u007f", "euro €"]) {
      expect(isHeaderValue(value), value).toBe(false)
    }
  })

  it("knows a secret header by its name", () => {
    for (const name of ["Authorization", "Cookie", "X-Api-Key", "X-APIKEY", "X-Auth-Token"]) {
      expect(isSecretHeader(name), name).toBe(true)
    }
    expect(isSecretHeader("X-Tenant-Id")).toBe(false)
  })
})
