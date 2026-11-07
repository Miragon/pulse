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

  const errorOf = (env: NodeJS.ProcessEnv): Error => {
    try {
      engineModule.configFromEnv(env)
    } catch (error) {
      return error as Error
    }
    throw new Error("configFromEnv accepted the config")
  }

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
})
