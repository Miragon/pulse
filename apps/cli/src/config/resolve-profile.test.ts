/** The profile selection and the validation of URL, output and platform (resolve.ts). */

import { describe, expect, it } from "vitest"
import { failure } from "../../test/support/failure.js"
import { OperateError } from "../errors.js"
import { configError } from "./config-error.js"
import {
  findProfile,
  missingProfileError,
  resolvePlatform,
  selectProfile,
  validateOutput,
  validatePlatform,
  validateUrl,
} from "./resolve.js"
import { redactUrl } from "./redact.js"
import { type ConfigFile, PLATFORMS, type Profile } from "./types.js"

describe("selectProfile", () => {
  const config: ConfigFile = {
    defaultProfile: "dev",
    profiles: { dev: { engine: "d" }, prod: { engine: "p" }, test: { engine: "t" } },
  }

  it("selects the profile by flag, then OPERATE_PROFILE, then defaultProfile", () => {
    const env = { OPERATE_PROFILE: "test" }
    expect(selectProfile({ profile: "prod" }, env, config)).toEqual({
      name: "prod",
      profile: { engine: "p" },
    })
    expect(selectProfile({}, env, config).name).toBe("test")
    expect(selectProfile({}, {}, config).name).toBe("dev")
    expect(selectProfile({ profile: " " }, { OPERATE_PROFILE: "" }, config).name).toBe("dev")
  })

  it("selects nothing without a name", () => {
    expect(selectProfile({}, {}, undefined)).toEqual({})
    expect(selectProfile({}, {}, { profiles: { a: {} } })).toEqual({})
    expect(selectProfile({}, {}, { defaultProfile: " ", profiles: {} })).toEqual({})
  })

  it("explains a missing profile selected by flag", () => {
    const error = failure(() => selectProfile({ profile: "qa" }, {}, config))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe('Profile "qa" does not exist')
    expect(error.details.hint).toBe(
      "Known profiles: dev, prod, test. Create it with `operate config set qa --url <url>`.",
    )
  })

  it("names OPERATE_PROFILE when it selects a missing profile", () => {
    const error = failure(() => selectProfile({}, { OPERATE_PROFILE: "qa" }, undefined))
    expect(error.details.hint).toBe(
      "It is selected by OPERATE_PROFILE. Create it with `operate config set qa --url <url>`.",
    )
  })

  it("names defaultProfile when it points to a missing profile", () => {
    const error = failure(() =>
      selectProfile({}, {}, { defaultProfile: "gone", profiles: { a: {} } }),
    )
    expect(error.details.hint).toBe(
      "It is the defaultProfile of the config file; choose another one with `operate config use <profile>`. Known profiles: a. Create it with `operate config set gone --url <url>`.",
    )
  })

  it("does not treat inherited object properties as profiles", () => {
    for (const name of ["constructor", "toString", "hasOwnProperty"]) {
      expect(failure(() => selectProfile({ profile: name }, {}, config)).message).toBe(
        `Profile "${name}" does not exist`,
      )
    }
  })
})

describe("configError", () => {
  it("creates a CONFIG error with an optional hint", () => {
    const plain = configError("broken")
    expect(plain).toBeInstanceOf(OperateError)
    expect(plain.code).toBe("CONFIG")
    expect(plain.exitCode).toBe(3)
    expect(plain.message).toBe("broken")
    expect(plain.details).toStrictEqual({})
    expect(configError("broken", "fix it").details).toEqual({ hint: "fix it" })
  })
})

describe("findProfile and missingProfileError", () => {
  it("finds own profiles only", () => {
    const config: ConfigFile = { profiles: { a: { engine: "x" } } }
    expect(findProfile(config, "a")).toEqual({ engine: "x" })
    expect(findProfile(config, "b")).toBeUndefined()
    expect(findProfile(config, "constructor")).toBeUndefined()
    expect(findProfile(undefined, "a")).toBeUndefined()
  })

  it("defaults to the flag wording", () => {
    expect(missingProfileError("x", undefined).details.hint).toBe(
      "Create it with `operate config set x --url <url>`.",
    )
  })
})

describe("validateUrl", () => {
  it.each([
    ["http://localhost:8080/engine-rest", "http://localhost:8080/engine-rest"],
    ["http://localhost:8080/engine-rest/", "http://localhost:8080/engine-rest"],
    ["https://example.com/engine-rest///", "https://example.com/engine-rest"],
    ["  https://example.com/rest  ", "https://example.com/rest"],
    ["HTTP://EXAMPLE.COM/", "HTTP://EXAMPLE.COM"],
    ["http://[::1]:8080", "http://[::1]:8080"],
  ])("accepts %s as %s", (input, output) => {
    expect(validateUrl(input)).toBe(output)
  })

  it.each(["", "localhost", "/engine-rest", "http://"])('rejects the malformed URL "%s"', (url) => {
    const error = failure(() => validateUrl(url))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe(`Invalid engine URL "${url.trim()}"`)
    expect(error.details.hint).toBe("Example: http://localhost:8080/engine-rest")
  })

  it.each(["ftp://example.com", "file:///tmp", "localhost:8080/engine-rest"])(
    "rejects the non-HTTP URL %s",
    (url) => {
      const error = failure(() => validateUrl(url))
      expect(error.message).toBe(`Engine URL must start with http:// or https://, got "${url}"`)
      expect(error.details.hint).toBe("Example: http://localhost:8080/engine-rest")
    },
  )

  it.each([
    ["user:SECRETPW@localhost:8080", "***@localhost:8080"],
    ["localhost:8080/rest?token=SECRET", "localhost:8080/rest?…"],
    ["mailto:a:SECRET@host?x", "***@host?…"],
  ])("never repeats credentials of the rejected URL %s", (url, shown) => {
    const error = failure(() => validateUrl(url))
    expect(error.message).toBe(`Engine URL must start with http:// or https://, got "${shown}"`)
    expect(error.message).not.toContain("SECRET")
  })

  it.each(["http://user:secret@host/rest", "http://user@host/rest", "http://:pw@host"])(
    "rejects credentials in %s without repeating them",
    (url) => {
      const error = failure(() => validateUrl(url))
      expect(error.message).toBe("Engine URL must not contain credentials")
      expect(error.message).not.toContain("secret")
      expect(error.details.hint).toBe(
        "Remove the user info from the URL and use Basic auth: --auth basic --auth-user <name> with the password from --auth-password-stdin or OPERATE_PASSWORD.",
      )
    },
  )

  it.each([
    ["http://user:secret@:bad/rest", "http://***@:bad/rest"],
    ["file://user:secret@host/x", "file://***@host/x"],
    ["http://a@b:secret@/x", "http://***@/x"],
  ])("hides the user info of the malformed URL %s", (url, shown) => {
    const error = failure(() => validateUrl(url))
    expect(error.message).toBe(`Invalid engine URL "${shown}"`)
  })

  it.each(["ftp://user:secret@host", "ws://user:secret@host/x", "http://user:secret@host/r?q=1"])(
    "reports credentials in %s before any message that would repeat the URL",
    (url) => {
      const error = failure(() => validateUrl(url))
      expect(error.message).toBe("Engine URL must not contain credentials")
      expect(JSON.stringify(error.details)).not.toContain("secret")
    },
  )

  it.each(["http://host/rest?x=1", "http://host/rest?", "http://host/rest#top"])(
    "rejects the query or fragment in %s without repeating it",
    (url) => {
      const error = failure(() => validateUrl(url))
      expect(error.message).toBe(
        'Engine URL must not contain a query string or fragment, got "http://host/rest?…"',
      )
      expect(error.details.hint).toBe(
        "Pass credentials as a header (-H, OPERATE_HEADERS) instead. Example URL: http://localhost:8080/engine-rest",
      )
    },
  )

  it("redactUrl hides user info and everything after ? or #", () => {
    expect(redactUrl("http://h/x")).toBe("http://h/x")
    expect(redactUrl("http://a:b@h/x?t=1")).toBe("http://***@h/x?…")
    expect(redactUrl("a:b@c@h")).toBe("***@h")
    expect(redactUrl("?only")).toBe("?…")
  })
})

describe("validateOutput", () => {
  it("accepts json and table", () => {
    expect(validateOutput("json")).toBe("json")
    expect(validateOutput("table")).toBe("table")
  })

  it("rejects other formats with the list of choices", () => {
    const error = failure(() => validateOutput("JSON"))
    expect(error.message).toBe('Unknown output format "JSON"')
    expect(error.details.hint).toBe("Use one of: json, table")
  })
})

describe("validatePlatform", () => {
  it("accepts every engine with an adapter, trimmed", () => {
    for (const platform of PLATFORMS) expect(validatePlatform(` ${platform} `)).toBe(platform)
  })

  it("rejects other values with the list of known engines", () => {
    const error = failure(() => validatePlatform("camunda8"))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe('Unknown platform "camunda8"')
    expect(error.details.hint).toBe("Use one of: operaton, cibseven, camunda7")
  })
})

describe("resolvePlatform", () => {
  it("takes the flag, then OPERATE_PLATFORM, then the profile, else camunda7", () => {
    const env = { OPERATE_PLATFORM: "cibseven" }
    const profile: Profile = { platform: "operaton" }
    expect(resolvePlatform({ platform: "camunda7" }, env, profile)).toEqual({
      value: "camunda7",
      source: "flag",
    })
    expect(resolvePlatform({}, env, profile)).toEqual({ value: "cibseven", source: "env" })
    expect(resolvePlatform({}, {}, profile)).toEqual({ value: "operaton", source: "profile" })
    expect(resolvePlatform({}, {}, undefined)).toEqual({ value: "camunda7", source: "default" })
  })

  it("fails on an unknown value of the environment", () => {
    const error = failure(() => resolvePlatform({}, { OPERATE_PLATFORM: "zeebe" }, undefined))
    expect(error.message).toBe('Unknown platform "zeebe"')
  })
})
