import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { file } from "../../test/support/config-resolve.js"
import { failure } from "../../test/support/failure.js"
import { parseEnvHeaders } from "./headers.js"
import { MAX_TIMEOUT_MS, isEngineName, resolveConfig, validateEngine } from "./resolve.js"
import { type ConfigFlags, PLATFORMS, type Profile } from "./types.js"

const DEFAULT_SOURCES = {
  url: "default",
  engine: "default",
  platform: "default",
  auth: "default",
  output: "default",
  timeout: "default",
  headers: "default",
  readOnly: "default",
}

describe("resolveConfig defaults", () => {
  it("resolves the defaults without flags, environment or file", () => {
    expect(resolveConfig({}, {}, undefined)).toEqual({
      url: "http://localhost:8080/engine-rest",
      platform: "camunda7",
      auth: { type: "none" },
      timeoutMs: 30000,
      headers: {},
      readOnly: false,
      sources: DEFAULT_SOURCES,
    })
  })

  it("treats blank flags and environment variables as unset", () => {
    const env = {
      OPERATE_URL: " ",
      OPERATE_ENGINE: "",
      OPERATE_PLATFORM: " ",
      OPERATE_OUTPUT: "",
      OPERATE_TIMEOUT: " ",
      OPERATE_AUTH: "",
      OPERATE_READ_ONLY: "",
      OPERATE_PROFILE: "",
    }
    const flags: ConfigFlags = { url: "", engine: " ", platform: "", output: "", profile: "" }
    expect(resolveConfig(flags, env, undefined).sources).toEqual(DEFAULT_SOURCES)
  })

  it("trims flag and environment values", () => {
    const resolved = resolveConfig(
      { engine: " e1 " },
      { OPERATE_URL: " http://x/ ", OPERATE_OUTPUT: " json " },
      undefined,
    )
    expect(resolved.engine).toBe("e1")
    expect(resolved.url).toBe("http://x")
    expect(resolved.output).toBe("json")
  })
})

describe("resolveConfig precedence", () => {
  const profile: Profile = {
    url: "http://profile:8080/engine-rest",
    engine: "profile-engine",
    platform: "operaton",
    auth: { type: "none" },
    output: "table",
    timeout: 3000,
    headers: { "X-Profile": "p" },
    readOnly: true,
  }
  const env = {
    OPERATE_URL: "http://env:8080/engine-rest",
    OPERATE_ENGINE: "env-engine",
    OPERATE_PLATFORM: "cibseven",
    OPERATE_OUTPUT: "json",
    OPERATE_TIMEOUT: "2000",
    OPERATE_AUTH: "none",
    OPERATE_READ_ONLY: "false",
  }
  const flags: ConfigFlags = {
    url: "http://flag:8080/engine-rest/",
    engine: "flag-engine",
    platform: "camunda7",
    output: "table",
    timeout: "1000",
    headers: ["X-Flag: f"],
    readOnly: true,
  }

  it("takes every value from the profile", () => {
    const resolved = resolveConfig({}, {}, file(profile))
    expect(resolved).toEqual({
      profile: "p",
      url: "http://profile:8080/engine-rest",
      engine: "profile-engine",
      platform: "operaton",
      auth: { type: "none", off: 'Basic auth is switched off by the auth.type of profile "p"' },
      output: "table",
      timeoutMs: 3000,
      headers: { "X-Profile": "p" },
      readOnly: true,
      sources: {
        url: "profile",
        engine: "profile",
        platform: "profile",
        auth: "profile",
        output: "profile",
        timeout: "profile",
        headers: "profile",
        readOnly: "profile",
      },
    })
  })

  it("lets the environment override the profile", () => {
    const resolved = resolveConfig({}, env, file(profile))
    expect(resolved).toMatchObject({
      url: "http://env:8080/engine-rest",
      engine: "env-engine",
      output: "json",
      timeoutMs: 2000,
      readOnly: false,
      sources: {
        url: "env",
        engine: "env",
        auth: "env",
        output: "env",
        timeout: "env",
        headers: "profile",
        readOnly: "env",
      },
    })
  })

  it("lets flags override the environment", () => {
    const resolved = resolveConfig(flags, env, file(profile))
    expect(resolved).toMatchObject({
      url: "http://flag:8080/engine-rest",
      engine: "flag-engine",
      output: "table",
      timeoutMs: 1000,
      headers: { "X-Profile": "p", "X-Flag": "f" },
      readOnly: true,
      sources: {
        url: "flag",
        engine: "flag",
        auth: "env",
        output: "flag",
        timeout: "flag",
        headers: "flag",
        readOnly: "flag",
      },
    })
  })

  it("lets a false read-only flag override a read-only profile", () => {
    const resolved = resolveConfig({ readOnly: false }, {}, file({ readOnly: true }))
    expect(resolved.readOnly).toBe(false)
    expect(resolved.sources.readOnly).toBe("flag")
  })

  it("merges header flags over profile headers case-insensitively", () => {
    const resolved = resolveConfig(
      { headers: ["authorization: Bearer flag", "X-A: 1", "x-a: 2"] },
      {},
      file({ headers: { Authorization: "Bearer profile", "X-B": "b" } }),
    )
    expect(resolved.headers).toEqual({ authorization: "Bearer flag", "X-B": "b", "x-a": "2" })
    expect(resolved.sources.headers).toBe("flag")
  })

  it("merges OPERATE_HEADERS between profile headers and header flags", () => {
    const env = { OPERATE_HEADERS: "Authorization: Bearer env\nX-Env: e\r\n\n  " }
    const fromEnv = resolveConfig({}, env, file({ headers: { authorization: "p", "X-P": "p" } }))
    expect(fromEnv.headers).toEqual({ "X-P": "p", Authorization: "Bearer env", "X-Env": "e" })
    expect(fromEnv.sources.headers).toBe("env")
    const flag = resolveConfig({ headers: ["authorization: Bearer flag"] }, env, undefined)
    expect(flag.headers).toEqual({ "X-Env": "e", authorization: "Bearer flag" })
    expect(flag.sources.headers).toBe("flag")
    expect(resolveConfig({}, { OPERATE_HEADERS: " " }, undefined).sources.headers).toBe("default")
  })

  it("rejects an invalid OPERATE_HEADERS without repeating the value", () => {
    const error = failure(() => parseEnvHeaders("X-Token secret"))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe('Invalid OPERATE_HEADERS: Invalid header: expected "Name: value"')
    expect(error.message).not.toContain("secret")
    expect(error.details.hint).toBe(
      "Example: OPERATE_HEADERS='X-API-Key: <key>'; separate several headers with line breaks. A bearer token goes into OPERATE_TOKEN (--auth bearer).",
    )
    expect(parseEnvHeaders(undefined)).toEqual({})
  })

  it('rejects the engine names "." and ".." from every source', () => {
    expect(failure(() => resolveConfig({ engine: ".." }, {}, undefined)).message).toBe(
      'Invalid process engine name ".."',
    )
    expect(failure(() => resolveConfig({}, { OPERATE_ENGINE: " . " }, undefined)).code).toBe(
      "CONFIG",
    )
    expect(resolveConfig({ engine: " second " }, {}, undefined).engine).toBe("second")
    expect(validateEngine("a.b")).toBe("a.b")
    expect(isEngineName("...")).toBe(true)
    expect(isEngineName(" ")).toBe(false)
    expect(isEngineName(3)).toBe(false)
  })

  it("reports headers from the profile as profile and empty flags as default", () => {
    expect(resolveConfig({ headers: [] }, {}, file({ headers: { A: "b" } })).sources.headers).toBe(
      "profile",
    )
    expect(resolveConfig({ headers: [] }, {}, file({ headers: {} })).sources.headers).toBe(
      "default",
    )
  })

  it("validates values from every source", () => {
    expect(failure(() => resolveConfig({ output: "yaml" }, {}, undefined)).message).toBe(
      'Unknown output format "yaml"',
    )
    expect(failure(() => resolveConfig({}, { OPERATE_TIMEOUT: "soon" }, undefined)).message).toBe(
      'Timeout must be a positive number of milliseconds, got "soon"',
    )
    expect(failure(() => resolveConfig({}, { OPERATE_AUTH: "digest" }, undefined)).message).toBe(
      'Unsupported auth type "digest"',
    )
    expect(failure(() => resolveConfig({ auth: "Basic" }, {}, undefined)).message).toBe(
      'Unsupported auth type "Basic"',
    )
    expect(failure(() => resolveConfig({}, { OPERATE_URL: "nope" }, undefined)).message).toBe(
      'Invalid engine URL "nope"',
    )
    expect(failure(() => resolveConfig({ headers: ["bad"] }, {}, undefined)).code).toBe("CONFIG")
    expect(failure(() => resolveConfig({}, { OPERATE_READ_ONLY: "maybe" }, undefined)).code).toBe(
      "CONFIG",
    )
  })

  it("rejects an unsupported auth type stored in the profile", () => {
    const config = file({ auth: { type: "digest" } as unknown as NonNullable<Profile["auth"]> })
    expect(failure(() => resolveConfig({}, {}, config)).message).toBe(
      'Unsupported auth type "digest"',
    )
  })

  type Choice<T> = readonly [flag: T | undefined, env: T | undefined, profile: T | undefined]

  function choice<T>(value: fc.Arbitrary<T>): fc.Arbitrary<Choice<T>> {
    const optional = fc.option(value, { nil: undefined })
    return fc.tuple(optional, optional, optional)
  }

  function expected<T>([flag, env, profile]: Choice<T>, fallback: T) {
    if (flag !== undefined) return { value: flag, source: "flag" }
    if (env !== undefined) return { value: env, source: "env" }
    if (profile !== undefined) return { value: profile, source: "profile" }
    return { value: fallback, source: "default" }
  }

  it("always takes the value of the highest-precedence defined source", () => {
    const urls = fc.constantFrom("http://a:1/engine-rest", "https://b/rest", "http://c")
    const engines = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/)
    const outputs = fc.constantFrom("json" as const, "table" as const)
    const platforms = fc.constantFrom(...PLATFORMS)
    const timeouts = fc.integer({ min: 1, max: MAX_TIMEOUT_MS })
    fc.assert(
      fc.property(
        fc.record({
          url: choice(urls),
          engine: choice(engines),
          platform: choice(platforms),
          output: choice(outputs),
          timeout: choice(timeouts),
          readOnly: choice(fc.boolean()),
          auth: fc.tuple(fc.constant(undefined), fc.boolean(), fc.boolean()),
        }),
        (c) => {
          const flags = {
            url: c.url[0],
            engine: c.engine[0],
            platform: c.platform[0],
            output: c.output[0],
            timeout: c.timeout[0]?.toString(),
            readOnly: c.readOnly[0],
          }
          const env = {
            OPERATE_URL: c.url[1],
            OPERATE_ENGINE: c.engine[1],
            OPERATE_PLATFORM: c.platform[1],
            OPERATE_OUTPUT: c.output[1],
            OPERATE_TIMEOUT: c.timeout[1]?.toString(),
            OPERATE_READ_ONLY: c.readOnly[1]?.toString(),
            OPERATE_AUTH: c.auth[1] ? "none" : undefined,
          }
          const profile = {
            url: c.url[2],
            engine: c.engine[2],
            platform: c.platform[2],
            output: c.output[2],
            timeout: c.timeout[2],
            readOnly: c.readOnly[2],
            ...(c.auth[2] ? { auth: { type: "none" as const } } : {}),
          }
          const resolved = resolveConfig(
            flags as ConfigFlags,
            env,
            file(JSON.parse(JSON.stringify(profile)) as Profile),
          )
          const url = expected(c.url, "http://localhost:8080/engine-rest")
          const engine = expected(c.engine, undefined)
          const platform = expected(c.platform, "camunda7")
          const output = expected(c.output, undefined)
          const timeout = expected(c.timeout, 30000)
          const readOnly = expected(c.readOnly, false)
          const auth = expected([undefined, c.auth[1] || undefined, c.auth[2] || undefined], false)
          expect(resolved.url).toBe(url.value)
          expect(resolved.engine).toBe(engine.value)
          expect(resolved.platform).toBe(platform.value)
          expect(resolved.output).toBe(output.value)
          expect(resolved.timeoutMs).toBe(timeout.value)
          expect(resolved.readOnly).toBe(readOnly.value)
          expect(resolved.sources).toEqual({
            url: url.source,
            engine: engine.source,
            platform: platform.source,
            auth: auth.source,
            output: output.source,
            timeout: timeout.source,
            headers: "default",
            readOnly: readOnly.source,
          })
        },
      ),
    )
  })
})
