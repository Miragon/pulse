import { describe, expect, it } from "vitest"
import type { ConfigView } from "../../config/edit.js"
import { maskedView, profileView, showHeader, showRows } from "./config-view.js"

const VIEW: ConfigView = {
  configFile: "/c.json",
  projectFile: null,
  profile: null,
  profileFile: null,
  values: {
    url: { value: "http://h/rest", source: "default" },
    cockpitUrl: { value: null, source: "default" },
    engine: { value: null, source: "default" },
    flavor: { value: "camunda7", source: "default" },
    auth: { value: "basic", source: "env" },
    username: { value: "demo", source: "env" },
    password: { value: "s3cret", source: "profile" },
    output: { value: "json", source: "env" },
    timeout: { value: 30000, source: "default" },
    headers: { value: { Cookie: "a=b", "X-A": "1" }, source: "flag" },
    readOnly: { value: false, source: "default" },
  },
}

describe("profileView", () => {
  it("shows a stored profile with name, default flag and masked headers", () => {
    const file = {
      defaultProfile: "a",
      profiles: { a: { url: "http://a", headers: { Authorization: "Bearer t" } }, b: {} },
    }
    expect(profileView(file, "a", {})).toEqual({
      name: "a",
      default: true,
      url: "http://a",
      headers: { Authorization: "Bearer ***" },
    })
    expect(profileView(file, "b", {})).toEqual({ name: "b", default: false })
    expect(JSON.stringify(profileView(file, "a", {}))).not.toContain("Bearer t")
    expect(profileView(file, "missing", {})).toEqual({ name: "missing", default: false })
  })
})

describe("profileView auth", () => {
  it("masks a stored password and keeps the other auth settings", () => {
    const file = {
      profiles: {
        literal: { auth: { type: "basic" as const, username: "demo", password: "s3cret" } },
        env: { auth: { username: "demo", passwordEnv: "PW" } },
      },
    }
    expect(profileView(file, "literal", {})).toEqual({
      name: "literal",
      default: false,
      auth: { type: "basic", username: "demo", password: "***" },
    })
    expect(profileView(file, "env", {})).toEqual({
      name: "env",
      default: false,
      auth: { username: "demo", passwordEnv: "PW" },
    })
    expect(file.profiles.literal.auth.password).toBe("s3cret")
  })

  it("masks a variable name that may be the secret itself: unusual and not set", () => {
    const auth = (key: string, name: string) => ({ profiles: { p: { auth: { [key]: name } } } })
    for (const key of ["passwordEnv", "tokenEnv"]) {
      expect(profileView(auth(key, "hunter2_pw"), "p", {}).auth).toEqual({ [key]: "***" })
      expect(profileView(auth(key, "hunter2_pw"), "p", { hunter2_pw: " " }).auth).toEqual({
        [key]: "***",
      })
      // set now, or in the usual form: a variable name, shown
      expect(profileView(auth(key, "ci_pw"), "p", { ci_pw: "x" }).auth).toEqual({ [key]: "ci_pw" })
      expect(profileView(auth(key, "CI_PW"), "p", {}).auth).toEqual({ [key]: "CI_PW" })
    }
    const mixed = { type: "basic" as const, username: "u", passwordEnv: "ghp_x1y2z3" }
    expect(
      Object.keys(profileView({ profiles: { p: { auth: mixed } } }, "p", {}).auth as object),
    ).toEqual(["type", "username", "passwordEnv"])
  })
})

describe("maskedView", () => {
  it("masks header values and the password unless secrets are shown", () => {
    const masked = maskedView(VIEW, false)
    expect(masked.values.headers).toEqual({
      value: { Cookie: "***", "X-A": "1" },
      source: "flag",
    })
    expect(masked.values.password).toEqual({ value: "***", source: "profile" })
    expect(masked.values.username).toBe(VIEW.values.username)
    expect(maskedView(VIEW, true)).toEqual(VIEW)
    expect(masked.values.url).toBe(VIEW.values.url)
  })

  it("keeps an unset password null", () => {
    const none = { value: null, source: "default" } as const
    const view = { ...VIEW, values: { ...VIEW.values, password: none } }
    expect(maskedView(view, false).values.password).toEqual(none)
  })
})

describe("showRows and showHeader", () => {
  it("lists KEY VALUE SOURCE rows in order", () => {
    expect(showRows(VIEW)).toEqual([
      { KEY: "url", VALUE: "http://h/rest", SOURCE: "default" },
      { KEY: "cockpitUrl", VALUE: null, SOURCE: "default" },
      { KEY: "engine", VALUE: null, SOURCE: "default" },
      { KEY: "flavor", VALUE: "camunda7", SOURCE: "default" },
      { KEY: "auth", VALUE: "basic", SOURCE: "env" },
      { KEY: "username", VALUE: "demo", SOURCE: "env" },
      { KEY: "password", VALUE: "s3cret", SOURCE: "profile" },
      { KEY: "output", VALUE: "json", SOURCE: "env" },
      { KEY: "timeout", VALUE: 30000, SOURCE: "default" },
      { KEY: "headers", VALUE: { Cookie: "a=b", "X-A": "1" }, SOURCE: "flag" },
      { KEY: "readOnly", VALUE: false, SOURCE: "default" },
    ])
  })

  it("names file and profile", () => {
    expect(showHeader(VIEW)).toBe("Config file: /c.json\nProfile: (none)\n\n")
    expect(showHeader({ ...VIEW, profile: "p" })).toBe("Config file: /c.json\nProfile: p\n\n")
  })
})
