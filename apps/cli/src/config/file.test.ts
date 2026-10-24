import { describe, expect, it } from "vitest"
import { OperateError } from "../errors.js"
import type { FileSystem } from "../runtime.js"
import { configFilePath, parseConfigFile, readConfigFile, writeConfigFile } from "./file.js"
import type { ConfigFile } from "./types.js"

const PATH = "/home/me/.config/operate/config.json"
const HINT = "Fix the file or recreate it with `operate config set`."
const HEADERS =
  "an object mapping header names (not Connection, Content-Length, Expect, Keep-Alive, Transfer-Encoding or Upgrade) to ISO-8859-1 (Latin-1) string values without control characters"
const ENGINE = 'a process engine name, not "." or ".."'
const LINUX = { homedir: "/home/me", platform: "linux" }
const WINDOWS = { homedir: "C:\\Users\\me", platform: "win32" }

interface Write {
  readonly path: string
  readonly data: string | Uint8Array
  readonly options: { mode?: number } | undefined
}

function memoryFs(files: Record<string, string> = {}) {
  const writes: Write[] = []
  const dirs: string[] = []
  const fs: FileSystem = {
    readFile: (path) => {
      const content = files[path]
      return content === undefined
        ? Promise.reject(new Error(`ENOENT: ${path}`))
        : Promise.resolve(new TextEncoder().encode(content))
    },
    writeFile: (path, data, options) => {
      writes.push({ path, data, options })
      return Promise.resolve()
    },
    mkdir: (path) => {
      dirs.push(path)
      return Promise.resolve()
    },
    exists: (path) => Promise.resolve(Object.hasOwn(files, path)),
    remove: () => Promise.resolve(false),
    readdir: () => Promise.resolve([]),
    kind: () => Promise.resolve("missing" as const),
  }
  return { fs, writes, dirs }
}

function parseFailure(text: string): OperateError {
  try {
    parseConfigFile(text, PATH)
  } catch (error) {
    if (error instanceof OperateError) return error
    throw error
  }
  throw new Error("expected parseConfigFile to fail")
}

function profileFailure(profile: unknown): string {
  return parseFailure(JSON.stringify({ profiles: { prod: profile } })).message
}

describe("configFilePath", () => {
  it("prefers the explicit path over OPERATE_CONFIG and the defaults", () => {
    const env = { OPERATE_CONFIG: "/env/config.json", XDG_CONFIG_HOME: "/xdg" }
    expect(configFilePath(env, LINUX, "./my.json")).toBe("./my.json")
  })

  it("uses OPERATE_CONFIG when there is no explicit path", () => {
    expect(configFilePath({ OPERATE_CONFIG: "/env/config.json" }, LINUX)).toBe("/env/config.json")
  })

  it("ignores a blank explicit path and falls back to OPERATE_CONFIG", () => {
    expect(configFilePath({ OPERATE_CONFIG: "/env/c.json" }, LINUX, "  ")).toBe("/env/c.json")
  })

  it("ignores a blank OPERATE_CONFIG", () => {
    expect(configFilePath({ OPERATE_CONFIG: "" }, LINUX)).toBe(PATH)
  })

  it("defaults to ~/.config/operate/config.json", () => {
    expect(configFilePath({}, LINUX)).toBe(PATH)
    expect(configFilePath({}, { homedir: "/Users/me", platform: "darwin" })).toBe(
      "/Users/me/.config/operate/config.json",
    )
  })

  it("honours an absolute XDG_CONFIG_HOME", () => {
    expect(configFilePath({ XDG_CONFIG_HOME: "/xdg" }, LINUX)).toBe("/xdg/operate/config.json")
  })

  it.each(["", "relative/dir", "./xdg"])('ignores XDG_CONFIG_HOME "%s"', (xdg) => {
    expect(configFilePath({ XDG_CONFIG_HOME: xdg }, LINUX)).toBe(PATH)
  })

  it("uses %APPDATA% on Windows", () => {
    const env = { APPDATA: "D:\\Roaming", XDG_CONFIG_HOME: "/xdg" }
    expect(configFilePath(env, WINDOWS)).toBe("D:\\Roaming\\operate\\config.json")
  })

  it("falls back to the roaming profile folder without a usable %APPDATA%", () => {
    const expected = "C:\\Users\\me\\AppData\\Roaming\\operate\\config.json"
    expect(configFilePath({}, WINDOWS)).toBe(expected)
    expect(configFilePath({ APPDATA: "" }, WINDOWS)).toBe(expected)
    expect(configFilePath({ APPDATA: "Roaming" }, WINDOWS)).toBe(expected)
  })

  it("uses the explicit path on Windows too", () => {
    expect(configFilePath({ APPDATA: "D:\\Roaming" }, WINDOWS, "C:\\x.json")).toBe("C:\\x.json")
  })
})

describe("parseConfigFile", () => {
  const full: ConfigFile = {
    defaultProfile: "prod",
    profiles: {
      prod: {
        url: "https://camunda.example.com/engine-rest",
        engine: "default",
        auth: { type: "none" },
        output: "table",
        timeout: 60000,
        headers: { "X-Tenant-Id": "acme" },
        readOnly: true,
      },
      local: {},
    },
  }

  it("accepts a complete file", () => {
    expect(parseConfigFile(JSON.stringify(full), PATH)).toEqual(full)
  })

  it("accepts and drops $schema", () => {
    const parsed = parseConfigFile('{"$schema":"https://x/schema.json","profiles":{}}', PATH)
    expect(parsed).toStrictEqual({ profiles: {} })
  })

  it("defaults missing profiles to an empty object", () => {
    expect(parseConfigFile("{}", PATH)).toStrictEqual({ profiles: {} })
    expect(parseConfigFile('{"defaultProfile":"a"}', PATH)).toEqual({
      defaultProfile: "a",
      profiles: {},
    })
  })

  it("reports JSON syntax errors with the path, line and column", () => {
    const error = parseFailure('{"profiles": ')
    expect(error.code).toBe("CONFIG")
    expect(error.exitCode).toBe(3)
    expect(error.message).toBe(`Invalid config file ${PATH}: not valid JSON (line 1, column 14)`)
    expect(error.details.hint).toBe(HINT)
  })

  it("never quotes the file content, which may hold a credential", () => {
    const text = '{"profiles":{"prod":{\n  "headers":{"X-API-Key": sk_live_0123456789abcdef}}}}'
    const error = parseFailure(text)
    expect(error.message).toBe(`Invalid config file ${PATH}: not valid JSON (line 2, column 27)`)
    expect(error.message).not.toContain("sk_live")
  })

  it.each(["[]", "null", '"text"', "1"])("rejects the root value %s", (text) => {
    expect(parseFailure(text).message).toBe(`Invalid config file ${PATH}: expected a JSON object`)
  })

  it("rejects unknown root keys and lists the allowed ones", () => {
    expect(parseFailure('{"profiles":{},"default":"a","x":1}').message).toBe(
      `Invalid config file ${PATH}: unknown key(s) default, x in the root object (allowed: $schema, defaultProfile, profiles)`,
    )
  })

  it("rejects a defaultProfile that is not a string", () => {
    expect(parseFailure('{"defaultProfile":1}').message).toBe(
      `Invalid config file ${PATH}: defaultProfile must be a string`,
    )
  })

  it("rejects profile names that config set would refuse (they name token files)", () => {
    const rule =
      'use letters, digits, ".", "_" and "-", starting with a letter or digit; rename it in the file'
    expect(parseFailure('{"profiles":{"x/../../victim/package":{}}}').message).toBe(
      `Invalid config file ${PATH}: invalid profile name "x/../../victim/package" (${rule})`,
    )
    expect(parseFailure('{"profiles":{"a\\nb":{}}}').message).toBe(
      `Invalid config file ${PATH}: invalid profile name "a\\nb" (${rule})`,
    )
    expect(parseFailure('{"profiles":{"ok":{}},"defaultProfile":" ../x "}').message).toBe(
      `Invalid config file ${PATH}: invalid defaultProfile "../x" (${rule})`,
    )
    for (const name of [".hidden", "-x", "a b", "p;rm", ""]) {
      expect(parseFailure(JSON.stringify({ profiles: { [name]: {} } })).message).toContain(
        `invalid profile name ${JSON.stringify(name)}`,
      )
    }
  })

  it("accepts valid names and a blank defaultProfile", () => {
    expect(
      parseConfigFile('{"defaultProfile":" ","profiles":{"prod-EU_1.x":{},"9":{}}}', PATH),
    ).toEqual({ defaultProfile: " ", profiles: { "prod-EU_1.x": {}, 9: {} } })
  })

  it.each(["[]", "null", '"a"'])("rejects profiles = %s", (profiles) => {
    expect(parseFailure(`{"profiles":${profiles}}`).message).toBe(
      `Invalid config file ${PATH}: profiles must be an object`,
    )
  })

  it.each([[[]], [null], ["url"]])("rejects the profile value %j", (profile) => {
    expect(profileFailure(profile)).toBe(
      `Invalid config file ${PATH}: profile "prod" must be an object`,
    )
  })

  it("accepts a cockpit URL and rejects a blank one", () => {
    expect(
      parseConfigFile(JSON.stringify({ profiles: { p: { cockpitUrl: "http://ops" } } }), PATH),
    ).toEqual({ profiles: { p: { cockpitUrl: "http://ops" } } })
    expect(profileFailure({ cockpitUrl: " " })).toContain("invalid cockpitUrl")
  })

  it("rejects unknown profile keys", () => {
    expect(profileFailure({ url: "http://x", user: "demo" })).toBe(
      `Invalid config file ${PATH}: unknown key(s) user in profile "prod" (allowed: url, cockpitUrl, engine, platform, auth, output, timeout, headers, readOnly)`,
    )
  })

  it.each([
    ["url", 42, "a URL such as http://localhost:8080/engine-rest"],
    ["url", " ", "a URL such as http://localhost:8080/engine-rest"],
    ["engine", "", ENGINE],
    ["engine", false, ENGINE],
    ["engine", "..", ENGINE],
    ["output", "yaml", "json or table"],
    ["output", null, "json or table"],
    ["timeout", 0, "a whole number of milliseconds between 1 and 2147483647"],
    ["timeout", -1, "a whole number of milliseconds between 1 and 2147483647"],
    ["timeout", 1.5, "a whole number of milliseconds between 1 and 2147483647"],
    ["timeout", "1000", "a whole number of milliseconds between 1 and 2147483647"],
    ["timeout", 2147483648, "a whole number of milliseconds between 1 and 2147483647"],
    ["headers", ["X: y"], HEADERS],
    ["headers", { "X-A": 1 }, HEADERS],
    ["headers", { "X A": "b" }, HEADERS],
    ["headers", "X: y", HEADERS],
    ["headers", { "X-A": "a\r\nX-Injected: 1" }, HEADERS],
    ["headers", { "X-A": "a\u0000" }, HEADERS],
    ["headers", { "X-User": "日本" }, HEADERS],
    ["headers", { "X-A": "a\u0001b" }, HEADERS],
    ["headers", { "Transfer-Encoding": "chunked" }, HEADERS],
    ["readOnly", "true", "true or false"],
    ["readOnly", 1, "true or false"],
  ])("rejects %s = %j", (key, value, expected) => {
    expect(profileFailure({ [key]: value })).toBe(
      `Invalid config file ${PATH}: profile "prod" has an invalid ${key} (expected ${expected})`,
    )
  })

  const AUTH_OBJECT = '{"type": "basic", "username": "demo", "passwordEnv": "CAMUNDA_PASSWORD"}'
  const ENV_NAME = "the name of an environment variable, e.g. CAMUNDA_PASSWORD"

  it.each([
    [
      "none",
      `Invalid config file ${PATH}: profile "prod" has an invalid auth (expected ${AUTH_OBJECT})`,
    ],
    [
      null,
      `Invalid config file ${PATH}: profile "prod" has an invalid auth (expected ${AUTH_OBJECT})`,
    ],
    [
      { type: "basic", user: "demo", pass: "x" },
      `Invalid config file ${PATH}: unknown key(s) user, pass in the auth of profile "prod" (allowed: type, username, passwordEnv, password, issuer, authorizationEndpoint, tokenEndpoint, clientId, clientSecretEnv, clientSecret, scopes, audience, redirectPort, tokenEnv, token)`,
    ],
    [
      { type: 1 },
      `Invalid config file ${PATH}: profile "prod" has an invalid auth.type (expected none, basic, oauth or bearer)`,
    ],
    [
      { username: " " },
      `Invalid config file ${PATH}: profile "prod" has an invalid auth.username (expected a non-empty string)`,
    ],
    [
      { username: "demo", passwordEnv: "MY-VAR" },
      `Invalid config file ${PATH}: profile "prod" has an invalid auth.passwordEnv (expected ${ENV_NAME})`,
    ],
    [
      { username: "demo", passwordEnv: 7 },
      `Invalid config file ${PATH}: profile "prod" has an invalid auth.passwordEnv (expected ${ENV_NAME})`,
    ],
    [
      { username: "demo", password: "" },
      `Invalid config file ${PATH}: profile "prod" has an invalid auth.password (expected a non-empty string)`,
    ],
    [
      { username: "demo", password: "secret-value", passwordEnv: "PW" },
      `Invalid config file ${PATH}: profile "prod" sets both auth.password and auth.passwordEnv; keep one (passwordEnv is recommended)`,
    ],
  ])("rejects auth = %j", (auth, message) => {
    expect(profileFailure({ auth })).toBe(message)
    expect(profileFailure({ auth })).not.toContain("secret-value")
  })

  it("checks the profile keys in their order", () => {
    expect(profileFailure({ output: "yaml", auth: "none", url: 1 })).toContain("invalid url")
    expect(profileFailure({ output: "yaml", auth: "none" })).toContain("invalid auth (")
  })

  it.each([
    ["url", "http://localhost:8080/engine-rest"],
    ["engine", "tenant1"],
    ["auth", { type: "none" }],
    ["auth", { type: "basic" }],
    ["auth", {}],
    ["auth", { username: "demo", passwordEnv: "CAMUNDA_PASSWORD" }],
    ["auth", { type: "basic", username: "d:x", password: " p:ä " }],
    ["output", "json"],
    ["output", "table"],
    ["timeout", 1],
    ["timeout", 2147483647],
    ["headers", {}],
    ["headers", { Authorization: "Bearer x", "x-a": "" }],
    ["headers", { "X-User": "Jos\u00e9 M\u00fcller \u00ff\ttab" }],
    ["readOnly", false],
  ])("accepts %s = %j", (key, value) => {
    const text = JSON.stringify({ profiles: { prod: { [key]: value } } })
    expect(parseConfigFile(text, PATH).profiles.prod).toEqual({ [key]: value })
  })
})

describe("readConfigFile", () => {
  it("returns undefined when the file does not exist", async () => {
    const { fs } = memoryFs()
    await expect(readConfigFile(fs, PATH)).resolves.toBeUndefined()
  })

  it("reads and parses an existing file", async () => {
    const { fs } = memoryFs({ [PATH]: '{"defaultProfile":"a","profiles":{"a":{"engine":"e"}}}' })
    await expect(readConfigFile(fs, PATH)).resolves.toEqual({
      defaultProfile: "a",
      profiles: { a: { engine: "e" } },
    })
  })

  it("propagates parse errors", async () => {
    const { fs } = memoryFs({ [PATH]: "nope" })
    await expect(readConfigFile(fs, PATH)).rejects.toThrow(OperateError)
  })

  it("requires the file when the user named it", async () => {
    const { fs } = memoryFs()
    const error = await readConfigFile(fs, "/typo.json", true).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: "CONFIG",
      message: "Config file /typo.json does not exist",
      details: {
        hint: "Create it with `operate config set <profile> --url <url> --config /typo.json`, or fix the path of --config or OPERATE_CONFIG.",
      },
    })
  })

  it.each([
    ["exists", "EACCES"],
    ["readFile", "EISDIR"],
  ])("reports a failing %s as CONFIG error naming the path (%s)", async (method, code) => {
    const { fs } = memoryFs({ [PATH]: "{}" })
    const failing = {
      ...fs,
      [method]: () => Promise.reject(Object.assign(new Error(`${code}: oops`), { code })),
    }
    const error = await readConfigFile(failing, PATH).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: "CONFIG",
      message: `Cannot read config file ${PATH} (${code})`,
    })
    expect((error as OperateError).details.hint).toContain("--config or OPERATE_CONFIG")
  })
})

describe("writeConfigFile", () => {
  it("creates the directory and writes indented JSON with mode 0600", async () => {
    const { fs, writes, dirs } = memoryFs()
    const config: ConfigFile = { defaultProfile: "a", profiles: { a: { url: "http://x" } } }
    await writeConfigFile(fs, PATH, config)
    expect(dirs).toEqual(["/home/me/.config/operate"])
    expect(writes).toEqual([
      {
        path: PATH,
        data: '{\n  "defaultProfile": "a",\n  "profiles": {\n    "a": {\n      "url": "http://x"\n    }\n  }\n}\n',
        options: { mode: 0o600 },
      },
    ])
  })

  it.each(["mkdir", "writeFile"])("reports a failing %s as CONFIG error", async (method) => {
    const { fs } = memoryFs()
    const failing = { ...fs, [method]: () => Promise.reject(new Error("disk on fire")) }
    const error = await writeConfigFile(failing, PATH, { profiles: {} }).catch(
      (caught: unknown) => caught,
    )
    expect(error).toMatchObject({
      code: "CONFIG",
      message: `Cannot write config file ${PATH} (disk on fire)`,
    })
  })

  it("writes what parseConfigFile reads back", async () => {
    const { fs, writes } = memoryFs()
    const config: ConfigFile = { profiles: { a: { headers: { "X-A": "b" }, readOnly: true } } }
    await writeConfigFile(fs, PATH, config)
    expect(parseConfigFile(String(writes[0]?.data), PATH)).toEqual(config)
  })
})
