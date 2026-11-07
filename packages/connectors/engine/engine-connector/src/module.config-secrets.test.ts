import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { engineModule } from "./module.js"

/** The boot prints this error: one trailing comma must not put the engine passwords into the log. */
describe("engineModule.configFromEnv never echoes the engine config", () => {
  const SECRET = "pl4nted-S3cret"
  const HIDDEN = "is not shown because it may hold credentials"
  const HINT = "Look for a trailing comma or a missing quote, for example."
  const QUOTED =
    "It starts with a quote: remove the quotes around the JSON, since some env files keep them."
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-engines-"))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  const thrownBy = (boot: () => unknown): Error => {
    try {
      boot()
    } catch (error) {
      return error as Error
    }
    throw new Error("the config was accepted")
  }
  const errorOf = (env: NodeJS.ProcessEnv) => thrownBy(() => engineModule.configFromEnv(env))

  it.each([
    // V8 quotes the input's tail here, and there is no position to pass on.
    [
      "a trailing comma in the array",
      `[{"id":"prod-a","baseUrl":"http://a.example/engine-rest","auth":{"type":"basic","username":"svc","password":"${SECRET}"}},]`,
      "",
    ],
    // V8 names the unexpected character and quotes a slice around it, the secret included.
    ["an unquoted value", `[{"id":"prod-a","auth":{"password":${SECRET}}}]`, ""],
    // V8 quotes an input under 21 characters whole: only its own closing suffix is a position.
    ["a position inside the value", "pw (line 9 column 9)", ""],
    [
      "a trailing comma in the map",
      `{"prod-eu":[{"id":"a","password":"${SECRET}"}],}`,
      " at line 1 column 53",
    ],
    [
      "a missing comma between entries",
      `[\n  {"id": "a", "password": "${SECRET}"}\n  {"id": "b"}\n]`,
      " at line 3 column 3",
    ],
    // The duplicate-key scan runs on valid JSON only, so it never reads a value as a key.
    [
      "a repeated key in malformed JSON",
      `{"prod-eu":[{"id":"a","password":"${SECRET}"}],"prod-eu":[{"id":"b"}],}`,
      " at line 1 column 76",
    ],
  ])("ENGINES_JSON with %s names the variable and the position only", (_case, json, at) => {
    const error = errorOf({ ENGINES_JSON: json })
    expect(error.message).toBe(`ENGINES_JSON is not valid JSON${at}; the value ${HIDDEN}. ${HINT}`)
    // Node prints a cause under the error, so the parser's message must not ride along.
    expect(error.cause).toBeUndefined()
  })

  it("ENGINES_FILE with malformed content names the variable and the resolved path only", () => {
    const file = path.join(dir, "engines.json")
    fs.writeFileSync(
      file,
      `[{"id":"prod-a","auth":{"type":"basic","username":"svc","password":"${SECRET}"}},]`,
    )
    const error = errorOf({ ENGINES_FILE: file })
    expect(error.message).toBe(
      `ENGINES_FILE=${file} is not valid JSON; its content ${HIDDEN}. ${HINT}`,
    )
    expect(error.cause).toBeUndefined()
  })

  it.each([
    ["single", `'[{"id":"a","password":"${SECRET}"}]'`, ""],
    ["double", `"[{"id":"a","password":"${SECRET}"}]"`, " at line 1 column 5"],
  ])("ENGINES_JSON wrapped in %s quotes says so", (_case, json, at) => {
    expect(errorOf({ ENGINES_JSON: json }).message).toBe(
      `ENGINES_JSON is not valid JSON${at}; the value ${HIDDEN}. ${QUOTED}`,
    )
  })

  it("ENGINES_FILE saved with a byte order mark loads", () => {
    const file = path.join(dir, "bom.json")
    const engines = [{ id: "prod-a", baseUrl: "http://a.example/engine-rest" }]
    fs.writeFileSync(file, `\uFEFF${JSON.stringify(engines)}`)
    expect(engineModule.configFromEnv({ ENGINES_FILE: file }).engines).toEqual(engines)
  })

  it("an empty ENGINES_FILE says it is empty", () => {
    const file = path.join(dir, "empty.json")
    fs.writeFileSync(file, "\uFEFF \n")
    expect(errorOf({ ENGINES_FILE: file }).message).toBe(`ENGINES_FILE=${file} is empty.`)
  })

  it("a missing or unreadable ENGINES_FILE names the variable and the resolved path", () => {
    const missing = "missing-engines.json"
    expect(errorOf({ ENGINES_FILE: missing }).message).toBe(
      `ENGINES_FILE=${missing} (resolved ${path.resolve(missing)}) does not exist.`,
    )
    expect(errorOf({ ENGINES_FILE: dir }).message).toBe(
      `ENGINES_FILE=${dir} cannot be read (EISDIR).`,
    )
  })

  it("inline JSON in ENGINES_FILE is not echoed as a path", () => {
    const error = errorOf({ ENGINES_FILE: `[{"id":"a","auth":{"password":"${SECRET}"}}]` })
    expect(error.message).toContain("ENGINES_FILE holds JSON instead of a file path")
    expect(error.message).not.toContain(SECRET)
    expect(error.cause).toBeUndefined()
  })

  it.each([
    ["a repeated key", `{"${SECRET}":[{"id":"a"}],"${SECRET}":[{"id":"b"}]}`],
    ["a key without an engine array", `{"${SECRET}":"x"}`],
    ["a contradicting environment", `{"prod-eu":[{"id":"a","environment":{"p":"${SECRET}"}}]}`],
  ])("names a key or value of %s only when it is an id", (_case, json) => {
    const { message } = errorOf({ ENGINES_JSON: json })
    expect(message).toContain("(not shown: not an id)")
    expect(message).not.toContain(SECRET)
  })

  /**
   * The rest of the sweep: a secret at every place of the settings. The one value a message
   * repeats is ENGINES_FILE's own path, the thing to fix (above). A boot warning names only what
   * this check let through, since the boot resolves the config before it warns (the app's
   * `test/boot-errors.test.ts`).
   */
  const expectNoSecret = (error: Error) => {
    expect(error.message).not.toContain(SECRET)
    expect(error.cause).toBeUndefined()
  }

  /** The array form, the environment map, a map whose key is the secret, and the file. */
  const listErrors = (engines: unknown[]): Error[] => {
    const file = path.join(dir, "secret-entry.json")
    fs.writeFileSync(file, JSON.stringify(engines))
    const envs: NodeJS.ProcessEnv[] = [
      { ENGINES_JSON: JSON.stringify(engines) },
      { ENGINES_JSON: JSON.stringify({ "prod-eu": engines }) },
      { ENGINES_JSON: JSON.stringify({ [SECRET]: engines }) },
      { ENGINES_FILE: file },
    ]
    return envs.map((env) => errorOf(env))
  }

  const BASE = "http://a.example/engine-rest"

  it.each([
    ["a password", `https://svc:${SECRET}@engine.example.com/engine-rest`],
    ["a user name", `https://${SECRET}@engine.example.com/engine-rest`],
    ["a query string", `https://engine.example.com/engine-rest?token=${SECRET}`],
    ["a fragment", `https://engine.example.com/engine-rest#${SECRET}`],
    ["no scheme", `svc:${SECRET}@engine:8080/engine-rest`],
    ["another scheme", `ftp://svc:${SECRET}@engine.example.com/engine-rest`],
  ])("a URL with %s fails the boot, and no message repeats it", (_case, url) => {
    expectNoSecret(errorOf({ ENGINE_BASE_URL: url }))
    expectNoSecret(errorOf({ ENGINE_BASE_URL: BASE, ENGINE_COCKPIT_URL: url }))
    for (const entry of [
      { id: "a", baseUrl: url },
      { id: "a", baseUrl: BASE, cockpitUrl: url },
    ]) {
      listErrors([entry]).forEach(expectNoSecret)
      // createPlugin parses a config no `configFromEnv` checked: a ZodError, its message the issues.
      expect(thrownBy(() => engineModule.createPlugin({ engines: [entry] })).message).not.toContain(
        SECRET,
      )
    }
  })

  it.each([
    ["the id", { id: SECRET, baseUrl: BASE }],
    ["an id that is no string", { id: { p: SECRET }, baseUrl: BASE }],
    ["a baseUrl that is no string", { id: "a", baseUrl: { p: SECRET } }],
    ["a cockpitUrl that is no string", { id: "a", baseUrl: BASE, cockpitUrl: [SECRET] }],
    ["the environment", { id: "a", baseUrl: BASE, environment: SECRET }],
    ["the flavor", { id: "a", baseUrl: BASE, flavor: SECRET }],
    ["the auth type", { id: "a", baseUrl: BASE, auth: { type: SECRET } }],
    ["an auth that is no object", { id: "a", baseUrl: BASE, auth: SECRET }],
    ["a lone password", { id: "a", baseUrl: BASE, auth: { type: "basic", password: SECRET } }],
    ["a lone username", { id: "a", baseUrl: BASE, auth: { type: "basic", username: SECRET } }],
    [
      "a password on bearer",
      { id: "a", baseUrl: BASE, auth: { type: "bearer", password: SECRET } },
    ],
    ["an unknown key", { id: "a", baseUrl: "no-url", [SECRET]: "x" }],
    ["an entry that is no object", SECRET],
  ])("an engine entry with a secret in %s fails the boot without it", (_place, entry) => {
    listErrors([entry]).forEach(expectNoSecret)
  })

  it.each<[string, NodeJS.ProcessEnv]>([
    ["ENGINE_ID", { ENGINE_ID: SECRET }],
    ["ENGINE_FLAVOR", { ENGINE_FLAVOR: SECRET }],
    ["ENGINE_DEFAULT", { ENGINE_DEFAULT: SECRET }],
    ["ENGINE_AUTH_TYPE", { ENGINE_AUTH_TYPE: SECRET }],
    ["ENGINE_USERNAME", { ENGINE_AUTH_TYPE: "basic", ENGINE_USERNAME: SECRET }],
    ["ENGINE_PASSWORD", { ENGINE_AUTH_TYPE: "basic", ENGINE_PASSWORD: SECRET }],
    ["ENGINE_TOKEN", { ENGINE_AUTH_TYPE: "basic", ENGINE_TOKEN: SECRET }],
    ["ENGINE_ALLOW_DEPLOYMENTS", { ENGINE_ALLOW_DEPLOYMENTS: SECRET }],
    ["ENGINE_REQUEST_TIMEOUT_MS", { ENGINE_REQUEST_TIMEOUT_MS: SECRET }],
    ["ENGINE_INCIDENT_ISSUE_REPO", { ENGINE_INCIDENT_ISSUE_REPO: SECRET }],
    ["ENGINE_HEALTH_CRITICAL_INCIDENTS", { ENGINE_HEALTH_CRITICAL_INCIDENTS: SECRET }],
    ["ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE", { ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE: SECRET }],
  ])("%s with a secret fails the boot without it", (_variable, env) => {
    expectNoSecret(errorOf(env))
  })

  describe("ENGINE_DEFAULT's error shows only ids", () => {
    const NOT_SHOWN = "(not shown: not an id)"
    const engines = [
      { id: "prod-a", baseUrl: BASE },
      { id: SECRET, baseUrl: BASE },
    ]

    it("hides a default that is no id", () => {
      const list = JSON.stringify([engines[0]])
      expect(errorOf({ ENGINES_JSON: list, ENGINE_DEFAULT: SECRET }).message).toBe(
        `ENGINE_DEFAULT=${NOT_SHOWN} names no configured engine (configured: prod-a).`,
      )
    })

    it("hides a configured id that is no id", () => {
      const list = JSON.stringify(engines)
      const { message } = errorOf({ ENGINES_JSON: list, ENGINE_DEFAULT: "prod-z" })
      expect(message).toContain(
        `ENGINE_DEFAULT=prod-z names no configured engine (configured: prod-a, ${NOT_SHOWN}).`,
      )
      expect(message).not.toContain(SECRET)
    })

    it("hides both from the ZodError a config no `configFromEnv` checked throws", () => {
      const error = thrownBy(() =>
        engineModule.createPlugin({ engines, defaultEngine: `${SECRET}-other` }),
      )
      expect(error.message).toContain("ENGINE_DEFAULT=")
      expect(error.message).not.toContain(SECRET)
    })
  })
})
