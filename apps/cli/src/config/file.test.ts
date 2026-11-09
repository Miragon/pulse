import { describe, expect, it } from "vitest"
import { PulseCliError } from "../errors.js"
import type { FileSystem } from "../runtime.js"
import { configFilePath, parseConfigFile, readConfigFile, writeConfigFile } from "./file.js"
import type { ConfigFile } from "./types.js"

const PATH = "/home/me/.config/pulse-cli/config.json"
const HINT = "Fix the file or recreate it with `pulse config set`."
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

function parseFailure(text: string): PulseCliError {
  try {
    parseConfigFile(text, PATH)
  } catch (error) {
    if (error instanceof PulseCliError) return error
    throw error
  }
  throw new Error("expected parseConfigFile to fail")
}

describe("configFilePath", () => {
  it("prefers the explicit path over PULSE_CLI_CONFIG and the defaults", () => {
    const env = { PULSE_CLI_CONFIG: "/env/config.json", XDG_CONFIG_HOME: "/xdg" }
    expect(configFilePath(env, LINUX, "./my.json")).toBe("./my.json")
  })

  it("uses PULSE_CLI_CONFIG when there is no explicit path", () => {
    expect(configFilePath({ PULSE_CLI_CONFIG: "/env/config.json" }, LINUX)).toBe("/env/config.json")
  })

  it("ignores a blank explicit path and falls back to PULSE_CLI_CONFIG", () => {
    expect(configFilePath({ PULSE_CLI_CONFIG: "/env/c.json" }, LINUX, "  ")).toBe("/env/c.json")
  })

  it("ignores a blank PULSE_CLI_CONFIG", () => {
    expect(configFilePath({ PULSE_CLI_CONFIG: "" }, LINUX)).toBe(PATH)
  })

  it("defaults to ~/.config/pulse-cli/config.json", () => {
    expect(configFilePath({}, LINUX)).toBe(PATH)
    expect(configFilePath({}, { homedir: "/Users/me", platform: "darwin" })).toBe(
      "/Users/me/.config/pulse-cli/config.json",
    )
  })

  it("honours an absolute XDG_CONFIG_HOME", () => {
    expect(configFilePath({ XDG_CONFIG_HOME: "/xdg" }, LINUX)).toBe("/xdg/pulse-cli/config.json")
  })

  it.each(["", "relative/dir", "./xdg"])('ignores XDG_CONFIG_HOME "%s"', (xdg) => {
    expect(configFilePath({ XDG_CONFIG_HOME: xdg }, LINUX)).toBe(PATH)
  })

  it("uses %APPDATA% on Windows", () => {
    const env = { APPDATA: "D:\\Roaming", XDG_CONFIG_HOME: "/xdg" }
    expect(configFilePath(env, WINDOWS)).toBe("D:\\Roaming\\pulse-cli\\config.json")
  })

  it("falls back to the roaming profile folder without a usable %APPDATA%", () => {
    const expected = "C:\\Users\\me\\AppData\\Roaming\\pulse-cli\\config.json"
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
        environment: "prod-eu",
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
    expect(parseConfigFile(JSON.stringify(full), PATH)).toStrictEqual(full)
  })

  it("keeps a $schema string; one of another kind is a note, and the file loads", () => {
    const parsed = parseConfigFile('{"$schema":"https://x/schema.json","profiles":{}}', PATH)
    expect(parsed).toStrictEqual({ $schema: "https://x/schema.json", profiles: {} })
    expect(parseConfigFile('{"$schema":1}', PATH)).toStrictEqual({
      profiles: {},
      notes: [{ code: "invalid", key: "$schema" }],
    })
  })

  it("defaults missing profiles to an empty object, and notes a default that names none", () => {
    expect(parseConfigFile("{}", PATH)).toStrictEqual({ profiles: {} })
    expect(parseConfigFile('{"defaultProfile":"a"}', PATH)).toStrictEqual({
      defaultProfile: "a",
      profiles: {},
      notes: [{ code: "default-not-found", key: "defaultProfile" }],
    })
  })

  it("reports JSON syntax errors with the path, line and column", () => {
    const error = parseFailure('{"profiles": ')
    expect(error.code).toBe("CONFIG")
    expect(error.exitCode).toBe(3)
    expect(error.message).toBe(
      `Invalid config file ${PATH}: The text is not valid JSON (line 1, column 14).`,
    )
    expect(error.details.hint).toBe(HINT)
  })

  it("never quotes the file content, which may hold a credential", () => {
    const text = '{"profiles":{"prod":{\n  "headers":{"X-API-Key": sk_live_0123456789abcdef}}}}'
    const error = parseFailure(text)
    expect(error.message).toBe(
      `Invalid config file ${PATH}: The text is not valid JSON (line 2, column 27).`,
    )
    expect(error.message).not.toContain("sk_live")
  })

  it.each(["[]", "null", '"text"', "1"])("fails the file for the root value %s", (text) => {
    expect(parseFailure(text).message).toBe(
      `Invalid config file ${PATH}: The file must hold one JSON object.`,
    )
  })

  it.each(["[]", "null", '"a"'])("fails the file for profiles = %s", (profiles) => {
    expect(parseFailure(`{"profiles":${profiles}}`).message).toBe(
      `Invalid config file ${PATH}: profiles must be a JSON object that maps each profile name to a profile.`,
    )
  })

  it("fails the file for a root key twice, which JSON.parse would read silently", () => {
    expect(parseFailure('{"profiles":{"a":{}},"profiles":{"b":{}}}').message).toBe(
      `Invalid config file ${PATH}: profiles is set twice, and JSON keeps only the last one without a word: set it once.`,
    )
  })

  it("keeps a root key the format does not know, as a note", () => {
    expect(parseConfigFile('{"profiles":{},"default":"a","x":1}', PATH)).toStrictEqual({
      profiles: {},
      notes: [
        { code: "unknown-root-key", key: "default" },
        { code: "unknown-root-key", key: "x" },
      ],
      unknown: { default: "a", x: 1 },
    })
  })

  it("refuses a broken profile and keeps it as the file holds it, the others load", () => {
    const text = JSON.stringify({
      profiles: { prod: { url: 42, flavour: "x" }, local: { url: "http://localhost:8080" } },
    })
    expect(parseConfigFile(text, PATH)).toStrictEqual({
      profiles: { prod: { url: 42, flavour: "x" }, local: { url: "http://localhost:8080" } },
      refused: {
        prod: [
          { code: "unknown-key", key: "flavour" },
          { code: "invalid", key: "url" },
        ],
      },
    })
  })

  it("refuses a profile whose name is no valid name under its key, without naming it", () => {
    const parsed = parseConfigFile('{"profiles":{"x/../../victim":{},"ok":{},"a b":1}}', PATH)
    expect(parsed.refused).toStrictEqual({
      "x/../../victim": [{ code: "invalid-name" }],
      "a b": [{ code: "invalid-name" }, { code: "invalid" }],
    })
    expect(Object.keys(parsed.profiles)).toEqual(["x/../../victim", "ok", "a b"])
  })

  it("lets the user's own file hold a secret or the variable that holds it", () => {
    const auth = { type: "basic", username: "demo", passwordEnv: "ANY_VARIABLE" }
    const text = JSON.stringify({
      profiles: { a: { auth }, b: { auth: { type: "bearer", token: "t0k3n" } } },
    })
    expect(parseConfigFile(text, PATH).refused).toBeUndefined()
  })

  it("refuses the MCP server's passthrough, which the CLI cannot authenticate with", () => {
    const text = JSON.stringify({ profiles: { gw: { auth: { type: "passthrough" } } } })
    expect(parseConfigFile(text, PATH).refused).toStrictEqual({
      gw: [{ code: "auth-type-not-served", key: "auth.type" }],
    })
  })

  it("refuses a profile name or a key the text repeats, which JSON.parse reads silently", () => {
    const text = '{"profiles":{"a":{"readOnly":true,"readOnly":false},"b":{},"b":{}}}'
    expect(parseConfigFile(text, PATH).refused).toStrictEqual({
      a: [{ code: "duplicate-key", key: "readOnly" }],
      b: [{ code: "duplicate-name" }],
    })
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
    await expect(readConfigFile(fs, PATH)).rejects.toThrow(PulseCliError)
  })

  it("requires the file when the user named it", async () => {
    const { fs } = memoryFs()
    const error = await readConfigFile(fs, "/typo.json", true).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: "CONFIG",
      message: "Config file /typo.json does not exist",
      details: {
        hint: "Create it with `pulse config set <profile> --url <url> --config /typo.json`, or fix the path of --config or PULSE_CLI_CONFIG.",
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
    expect((error as PulseCliError).details.hint).toContain("--config or PULSE_CLI_CONFIG")
  })
})

describe("writeConfigFile", () => {
  it("creates the directory and writes indented JSON with mode 0600", async () => {
    const { fs, writes, dirs } = memoryFs()
    const config: ConfigFile = { defaultProfile: "a", profiles: { a: { url: "http://x" } } }
    await writeConfigFile(fs, PATH, config)
    expect(dirs).toEqual(["/home/me/.config/pulse-cli"])
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

  it("writes the root keys the format does not know behind the profiles, never what it found", async () => {
    const { fs, writes } = memoryFs()
    const config: ConfigFile = {
      profiles: { a: { url: 1 as unknown as string } },
      refused: { a: [{ code: "invalid", key: "url" }] },
      notes: [{ code: "unknown-root-key", key: "x" }],
      unknown: { x: 1 },
    }
    await writeConfigFile(fs, PATH, config)
    expect(JSON.parse(String(writes[0]?.data))).toStrictEqual({ profiles: { a: { url: 1 } }, x: 1 })
  })

  it("writes what parseConfigFile reads back", async () => {
    const { fs, writes } = memoryFs()
    const config: ConfigFile = {
      $schema: "./schema.json",
      profiles: { a: { headers: { "X-A": "b" }, readOnly: true } },
    }
    await writeConfigFile(fs, PATH, config)
    expect(String(writes[0]?.data)).toMatch(/^\{\n {2}"\$schema": "\.\/schema\.json",\n/)
    expect(parseConfigFile(String(writes[0]?.data), PATH)).toEqual(config)
  })
})
