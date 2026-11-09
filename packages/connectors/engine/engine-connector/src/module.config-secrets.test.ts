import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { engineModule } from "./module.js"

/**
 * A value planted where a secret could land, and a name that may be one: a profile name, or a
 * key in the operator's log, is shown only when it has the shape of one, so the planted name has
 * a blank in it (a key-shaped one is `KEY_SHAPED`).
 */
const SECRET = "pl4nted-S3cret"
const SECRET_NAME = "pl4nted S3cret"
/** A GitHub token, which has the shape of a key: the parser names such a key to the operator. */
const KEY_SHAPED = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
const BASE = "http://a.example/engine-rest"

const thrownBy = (boot: () => unknown): Error => {
  try {
    boot()
  } catch (error) {
    return error as Error
  }
  throw new Error("the config was accepted")
}
const errorOf = (env: NodeJS.ProcessEnv) => thrownBy(() => engineModule.configFromEnv(env))
const profiles = (entries: Record<string, unknown>) => JSON.stringify({ profiles: entries })

/** The boot prints this error: one trailing comma must not put the engine passwords into the log. */
describe("engineModule.configFromEnv never echoes the profile file", () => {
  const HIDDEN = "is not shown because it may hold credentials"
  const HINT = "Look for a trailing comma or a missing quote, for example."
  const QUOTED =
    "It starts with a quote: remove the quotes around the JSON, since some env files keep them."
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-engines-"))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

  it.each([
    [
      "a trailing comma",
      `{"profiles":{"a":{"url":"${BASE}","auth":{"type":"basic","username":"svc","password":"${SECRET}"}}},}`,
      " at line 1 column 127",
    ],
    [
      "an unquoted value",
      `{"profiles":{"a":{"auth":{"password":${SECRET}}}}}`,
      " at line 1 column 38",
    ],
    ["text that is no JSON at all", "pw (line 9 column 9)", " at line 1 column 1"],
    [
      "a missing comma between profiles",
      `{\n  "profiles": {"a": {"password": "${SECRET}"}\n  "b": {}}\n}`,
      " at line 3 column 3",
    ],
  ])("ENGINES_JSON with %s names the variable and the position only", (_case, json, at) => {
    const error = errorOf({ ENGINES_JSON: json })
    expect(error.message).toBe(`ENGINES_JSON is not valid JSON${at}; the value ${HIDDEN}. ${HINT}`)
    // Node prints a cause under the error, so the parser's message must not ride along.
    expect(error.cause).toBeUndefined()
  })

  it("ENGINES_FILE with malformed content names the variable and the path only", () => {
    const file = path.join(dir, "engines.json")
    fs.writeFileSync(file, `{"profiles":{"a":{"auth":{"password":"${SECRET}"}}},}`)
    const error = errorOf({ ENGINES_FILE: file })
    expect(error.message).toBe(
      `ENGINES_FILE=${file} is not valid JSON at line 1 column 58; its content ${HIDDEN}. ${HINT}`,
    )
    expect(error.cause).toBeUndefined()
  })

  it.each([
    ["single", `'{"profiles":{"a":{"auth":{"password":"${SECRET}"}}}}'`, " at line 1 column 1"],
    ["double", `"{"profiles":{}}"`, " at line 1 column 4"],
  ])("ENGINES_JSON wrapped in %s quotes says so", (_case, json, at) => {
    expect(errorOf({ ENGINES_JSON: json }).message).toBe(
      `ENGINES_JSON is not valid JSON${at}; the value ${HIDDEN}. ${QUOTED}`,
    )
  })

  it("ENGINES_FILE saved with a byte order mark loads", () => {
    const file = path.join(dir, "bom.json")
    fs.writeFileSync(file, `\uFEFF${profiles({ "prod-a": { url: BASE } })}`)
    expect(engineModule.configFromEnv({ ENGINES_FILE: file }).engines).toEqual([
      { id: "prod-a", baseUrl: BASE },
    ])
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
    const error = errorOf({ ENGINES_FILE: `{"profiles":{"a":{"auth":{"password":"${SECRET}"}}}}` })
    expect(error.message).toContain("ENGINES_FILE holds JSON instead of a file path")
    expect(error.message).not.toContain(SECRET)
    expect(error.cause).toBeUndefined()
  })
})

/**
 * A secret at every place of the settings and the profiles: no boot error, no boot warning, no
 * refused entry, no module config and no engine_list_engines result repeats it. The parser
 * hands on no raw value of a refused profile, so the module config holds none either.
 */
describe("a planted secret appears nowhere", () => {
  const expectNoSecret = (text: string) => {
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(SECRET_NAME)
  }

  /** Every text a boot with `env` produces: its error, or its config, warnings and engine list. */
  async function everythingSaid(env: NodeJS.ProcessEnv): Promise<string> {
    const warnings = engineModule.bootWarnings(env)
    let config: Record<string, unknown>
    try {
      config = engineModule.configFromEnv(env)
    } catch (error) {
      expect((error as Error).cause).toBeUndefined()
      return JSON.stringify([(error as Error).message, warnings])
    }
    const recording = recordingModuleServer()
    engineModule.createPlugin(config).register(recording.server)
    const listed = await recording.tool("engine_list_engines").call({})
    return JSON.stringify([config, warnings, listed, engineModule.instructions(config)])
  }

  it.each([
    ["a password in the url", { url: `https://svc:${SECRET}@engine.example.com/engine-rest` }],
    ["a user name in the url", { url: `https://${SECRET}@engine.example.com/engine-rest` }],
    ["a query string", { url: `https://engine.example.com/engine-rest?token=${SECRET}` }],
    ["a fragment", { url: `https://engine.example.com/engine-rest#${SECRET}` }],
    ["no scheme", { url: `svc:${SECRET}@engine:8080/engine-rest` }],
    ["the cockpit url", { url: BASE, cockpitUrl: `https://svc:${SECRET}@ops.example/webapp` }],
    ["a url that is no string", { url: { p: SECRET } }],
    ["the environment", { url: BASE, environment: SECRET }],
    ["the flavor", { url: BASE, flavor: SECRET }],
    ["the process engine", { url: BASE, engine: SECRET }],
    ["the auth type", { url: BASE, auth: { type: SECRET } }],
    ["an auth that is no object", { url: BASE, auth: SECRET }],
    ["a literal password", { url: BASE, auth: { type: "basic", username: "u", password: SECRET } }],
    ["a literal token", { url: BASE, auth: { type: "bearer", token: SECRET } }],
    ["a password on bearer", { url: BASE, auth: { type: "bearer", password: SECRET } }],
    [
      "a variable outside the prefix",
      { url: BASE, auth: { type: "bearer", tokenEnv: SECRET.replace("-", "_") } },
    ],
    ["a header value", { url: BASE, headers: { "X-Api-Key": SECRET } }],
    ["an unknown key", { url: BASE, [SECRET_NAME]: "x" }],
    ["a profile that is no object", SECRET],
  ])("in a refused profile: %s", async (_place, profile) => {
    for (const env of [
      // Alone, the boot fails; next to a usable one, it runs and refuses this one.
      { ENGINES_JSON: profiles({ x: profile }) },
      { ENGINES_JSON: profiles({ ok: { url: BASE }, x: profile }) },
    ]) {
      expectNoSecret(await everythingSaid(env))
    }
  })

  it("in a profile name or a defaultProfile", async () => {
    expectNoSecret(
      await everythingSaid({
        ENGINES_JSON: profiles({ ok: { url: BASE }, [SECRET_NAME]: { url: BASE } }),
      }),
    )
    expectNoSecret(
      await everythingSaid({
        ENGINES_JSON: JSON.stringify({
          defaultProfile: SECRET_NAME,
          profiles: { ok: { url: BASE } },
        }),
      }),
    )
  })

  /**
   * A token pasted as a key has the shape of one (`ghp_` and 36 characters), so the operator's
   * log names it as the parser does; the model reads only the keys of the format.
   */
  it.each([
    ["of a profile", { url: BASE, [KEY_SHAPED]: "x" }],
    ["of auth", { url: BASE, auth: { type: "none", [KEY_SHAPED]: "x" } }],
  ])("in a key-shaped key %s: never to the model", async (_place, profile) => {
    const env = { ENGINES_JSON: profiles({ ok: { url: BASE }, x: profile }) }
    const config = engineModule.configFromEnv(env)
    const recording = recordingModuleServer()
    engineModule.createPlugin(config).register(recording.server)
    const said = [
      config,
      await recording.tool("engine_list_engines").call({}),
      await recording.tool("engine_status").call({ engine: "x" }),
      engineModule.instructions(config),
    ]
    expect(JSON.stringify(said)).toContain("holds a key the profile format does not know")
    expect(JSON.stringify(said)).not.toContain(KEY_SHAPED)
    expect(engineModule.bootWarnings(env).join(" ")).toContain(KEY_SHAPED)
  })

  it("in a variable that holds a secret which the transport cannot send", async () => {
    const env = {
      ENGINES_JSON: profiles({
        ok: { url: BASE },
        x: { url: BASE, auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_X" } },
      }),
      ENGINE_SECRET_X: `${SECRET}\n${SECRET}`,
    }
    expectNoSecret(await everythingSaid(env))
  })

  it.each<[string, NodeJS.ProcessEnv]>([
    [
      "ENGINE_BASE_URL",
      { ENGINE_BASE_URL: `https://svc:${SECRET}@engine.example.com/engine-rest` },
    ],
    [
      "ENGINE_COCKPIT_URL",
      { ENGINE_BASE_URL: BASE, ENGINE_COCKPIT_URL: `https://svc:${SECRET}@c` },
    ],
    ["ENGINE_ID", { ENGINE_ID: SECRET_NAME }],
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
    const error = errorOf(env)
    expectNoSecret(error.message)
    expect(error.cause).toBeUndefined()
  })

  describe("ENGINE_DEFAULT's error shows only ids", () => {
    it("hides a default that is no id", () => {
      const env = { ENGINES_JSON: profiles({ "prod-a": { url: BASE } }), ENGINE_DEFAULT: SECRET }
      expect(errorOf(env).message).toBe(
        "ENGINE_DEFAULT=(not shown: not an id) names no configured engine (configured: prod-a).",
      )
    })

    it("names the configured ids, a refused one too, and hides one a direct caller made up", () => {
      const env = {
        ENGINES_JSON: profiles({ "prod-a": { url: BASE }, "prod-b": { headers: {} } }),
        ENGINE_DEFAULT: "prod-z",
      }
      expect(errorOf(env).message).toBe(
        "ENGINE_DEFAULT=prod-z names no configured engine (configured: prod-a, prod-b).",
      )
      const error = thrownBy(() =>
        engineModule.createPlugin({
          engines: [{ id: SECRET_NAME, baseUrl: BASE }],
          defaultEngine: `${SECRET}-other`,
        }),
      )
      expect(error.message).toContain("ENGINE_DEFAULT=")
      expectNoSecret(error.message)
    })
  })
})
