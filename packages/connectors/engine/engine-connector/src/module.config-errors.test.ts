import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { engineConfigSchema, engineModule } from "./module.js"

/**
 * The boot prints a config error as one line (`runComposedServer`), so the error names the
 * variable to fix and, in an engine list, the entry: never the schema path, never a ZodError.
 */
describe("engineModule.configFromEnv names the variable a setting came from", () => {
  const BASE_URL_ERROR =
    "Expected an http:// or https:// URL of the REST API root, e.g. http://localhost:8410/engine-rest"
  const ID_ERROR =
    "Engine id must be lowercase alphanumeric / dashes, starting with a letter or digit"
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
  const json = (value: unknown) => JSON.stringify(value)

  it("throws a plain one-line error: no ZodError, no cause", () => {
    const error = errorOf({ ENGINE_BASE_URL: "localhost:8410/engine-rest" })
    expect(error.name).toBe("Error")
    expect(error.cause).toBeUndefined()
    expect(error.message).not.toContain("\n")
  })

  it.each([
    [{ ENGINE_BASE_URL: "localhost:8410/engine-rest" }, `ENGINE_BASE_URL: ${BASE_URL_ERROR}`],
    [
      { ENGINE_BASE_URL: "http://a.example/engine-rest", ENGINE_COCKPIT_URL: "a.example/camunda" },
      "ENGINE_COCKPIT_URL: Expected an http:// or https:// URL",
    ],
    [{ ENGINE_ID: "Prod_A" }, `ENGINE_ID: ${ID_ERROR}`],
    [
      { ENGINE_AUTH_TYPE: "Basic" },
      'ENGINE_AUTH_TYPE: Invalid option: expected one of "basic"|"bearer"|"passthrough"|"none"',
    ],
    [{ ENGINE_INCIDENT_ISSUE_REPO: "acme" }, "ENGINE_INCIDENT_ISSUE_REPO: Expected `owner/repo`"],
    [
      { ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE: "0" },
      "ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE: Too small: expected number to be >0",
    ],
  ])("the shorthand and the settings: %o", (env, message) => {
    expect(errorOf(env).message).toBe(message)
  })

  it("keeps a message that names its variable already, the auth rule's included", () => {
    expect(errorOf({ ENGINE_REQUEST_TIMEOUT_MS: "30s" }).message).toBe(
      "ENGINE_REQUEST_TIMEOUT_MS must be a whole number of milliseconds",
    )
    expect(errorOf({ ENGINE_AUTH_TYPE: "basic", ENGINE_USERNAME: "demo" }).message).toBe(
      "ENGINE_AUTH_TYPE=basic requires ENGINE_USERNAME and ENGINE_PASSWORD (unless every engine carries its own auth); otherwise engine requests would silently run unauthenticated",
    )
  })

  it("names the entry of ENGINES_JSON, in the array and the environment-map form", () => {
    expect(
      errorOf({ ENGINES_JSON: json([{ id: "Prod_A", baseUrl: "http://a/engine-rest" }]) }).message,
    ).toBe(`ENGINES_JSON[0].id: ${ID_ERROR}`)
    const map = {
      "prod-eu": [
        { id: "eu-a", baseUrl: "http://eu-a/engine-rest" },
        { id: "eu-b", baseUrl: "eu-b:8080/engine-rest", auth: { type: "bearer" } },
      ],
    }
    expect(errorOf({ ENGINES_JSON: json(map) }).message).toBe(
      `ENGINES_JSON["prod-eu"][1].baseUrl: ${BASE_URL_ERROR}; ` +
        'ENGINES_JSON["prod-eu"][1].auth: engine auth type "bearer" requires token',
    )
  })

  it("never shows an environment key that is not an id", () => {
    const map = { "Prod EU s3cret": [{ id: "eu-a", baseUrl: "http://eu-a/engine-rest" }] }
    const { message } = errorOf({ ENGINES_JSON: json(map) })
    expect(message).toMatch(/^ENGINES_JSON\[\(not shown: not an id\)\]\[0\]\.environment: /)
    expect(message).not.toContain("s3cret")
  })

  it("names the variable for an environment map of the wrong shape", () => {
    const entry = { id: "a", baseUrl: "http://a/engine-rest" }
    expect(errorOf({ ENGINES_JSON: json({ prod: entry }) }).message).toMatch(
      /^ENGINES_JSON: environment "prod" must map to an ARRAY of engine entries, but got object\./,
    )
    expect(
      errorOf({ ENGINES_JSON: json({ prod: [{ ...entry, environment: "dev" }] }) }).message,
    ).toMatch(
      /^ENGINES_JSON: an entry under environment "prod" carries a contradicting environment "dev"\./,
    )
    expect(errorOf({ ENGINES_JSON: '{"prod":[],"prod":[]}' }).message).toMatch(
      /^ENGINES_JSON: duplicate environment key "prod"\./,
    )
    const file = path.join(dir, "map.json")
    fs.writeFileSync(file, json({ prod: entry }))
    expect(errorOf({ ENGINES_FILE: file }).message).toContain(
      `ENGINES_FILE=${file}: environment "prod" must map to an ARRAY`,
    )
  })

  it("names ENGINES_FILE and its path, then the entry", () => {
    const file = path.join(dir, "engines.json")
    fs.writeFileSync(file, json([{ id: "a", baseUrl: "http://a/engine-rest" }, { id: "b" }]))
    expect(errorOf({ ENGINES_FILE: file }).message).toBe(
      `ENGINES_FILE=${file} at [1].baseUrl: ${BASE_URL_ERROR}`,
    )
  })

  it("names the list for a rule over all its entries", () => {
    const twice = [
      { id: "a", baseUrl: "http://a/engine-rest" },
      { id: "a", baseUrl: "http://b/engine-rest" },
    ]
    expect(errorOf({ ENGINES_JSON: json(twice) }).message).toMatch(
      /^ENGINES_JSON: Engine ids must be unique across all environments/,
    )
    expect(errorOf({ ENGINES_JSON: "[]" }).message).toBe("ENGINES_JSON: Names no engine")
    expect(errorOf({ ENGINES_JSON: "42" }).message).toBe(
      'ENGINES_JSON: Expected an array of engines or an environment map {"<environment>": [engines…]}',
    )
  })

  it("puts every issue on the one line", () => {
    expect(errorOf({ ENGINE_ID: "Prod_A", ENGINE_FLAVOR: "flowable" }).message).toBe(
      `ENGINE_ID: ${ID_ERROR}; ENGINE_FLAVOR: Engine flavor must be "cibseven", "operaton" or "camunda7" (the entry's \`flavor\`, or ENGINE_FLAVOR next to ENGINE_BASE_URL)`,
    )
  })
})

/** `localhost:8410/engine-rest` parses as a URL with the scheme `localhost:`: every call then failed as a network error. */
describe("engine URLs are http(s) only", () => {
  const parse = (baseUrl: string, cockpitUrl?: string) =>
    engineConfigSchema.safeParse({
      engines: [{ id: "a", baseUrl, ...(cockpitUrl ? { cockpitUrl } : {}) }],
    }).success

  it.each([
    "http://localhost:8410/engine-rest",
    "https://engine.example.com/engine-rest",
    "http://engine:8080/engine-rest",
    "http://10.0.0.1:8080/engine-rest",
    "http://[::1]:8080/engine-rest",
    "https://svc:pw@engine.example.com/engine-rest",
  ])("accepts %s", (url) => {
    expect(parse(url)).toBe(true)
    expect(parse("http://a/engine-rest", url)).toBe(true)
  })

  it.each([
    "localhost:8410/engine-rest",
    "host.docker.internal:8410/engine-rest",
    "engine.example.com/engine-rest",
    "ftp://engine.example.com/engine-rest",
    "http://",
  ])("refuses %s for the REST root and the cockpit link", (url) => {
    expect(parse(url)).toBe(false)
    expect(parse("http://a/engine-rest", url)).toBe(false)
  })

  it("never echoes the URL, which may carry credentials", () => {
    let message = ""
    try {
      engineModule.configFromEnv({ ENGINE_BASE_URL: "svc:pl4nted-S3cret@engine:8080/engine-rest" })
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toMatch(/^ENGINE_BASE_URL: /)
    expect(message).not.toContain("pl4nted-S3cret")
  })
})
