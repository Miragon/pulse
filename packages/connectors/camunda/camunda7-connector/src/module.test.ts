import { afterEach, describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import { camunda7Module, camunda7ConfigSchema } from "./module.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("camunda7Module.toolsets (fail-closed policy)", () => {
  const vocabulary = camunda7Module.toolsets

  it("declares its toolset vocabulary", () => {
    expect(vocabulary.module).toBe("camunda7")
    expect(vocabulary.names).toEqual(["read-only", "operations", "admin"])
    expect(vocabulary.fallback).toBe("read-only")
    expect(vocabulary.authenticatedDefault).toBe("operations")
  })

  it("no suffix: read-only without OAuth, operations with it — never admin", () => {
    expect(vocabulary.effective(undefined, { authenticated: false })).toEqual({
      toolset: "read-only",
      source: "default",
    })
    expect(vocabulary.effective(undefined, { authenticated: true })).toEqual({
      toolset: "operations",
      source: "default",
    })
  })

  it("admin only when named; an empty or unknown suffix falls back to read-only", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(vocabulary.effective("admin", { authenticated: false })).toEqual({
      toolset: "admin",
      source: "suffix",
    })
    for (const suffix of ["", "root"]) {
      expect(vocabulary.effective(suffix, { authenticated: true })).toEqual({
        toolset: "read-only",
        source: "fallback",
      })
    }
  })

  it("durable writes are allowed in every toolset above the read-only floor", () => {
    expect(vocabulary.allowsDurableWrites("read-only")).toBe(false)
    expect(vocabulary.allowsDurableWrites("operations")).toBe(true)
    expect(vocabulary.allowsDurableWrites("admin")).toBe(true)
  })
})

/** Deploying is code execution in the engine JVM, so a typo fails the boot (`z.coerce.boolean` reads "false" as true). */
describe("CAMUNDA_ALLOW_DEPLOYMENTS", () => {
  const engine = { id: "prod-a", baseUrl: "http://engine.example/engine-rest" }
  const parsedFlag = (allowDeployments?: string) =>
    camunda7ConfigSchema.parse({ engines: [engine], allowDeployments }).allowDeployments

  it('parses "true" to true and "false" / unset to false', () => {
    expect(parsedFlag("true")).toBe(true)
    expect(parsedFlag("false")).toBe(false)
    expect(parsedFlag(undefined)).toBe(false)
    expect(camunda7ConfigSchema.parse({ engines: [engine] }).allowDeployments).toBe(false)
  })

  it.each(["yes", "1", "TRUE", " true", ""])("fails the boot on %j, naming the variable", (raw) => {
    expect(() => parsedFlag(raw)).toThrow(/CAMUNDA_ALLOW_DEPLOYMENTS/)
    const result = camunda7ConfigSchema.safeParse({ engines: [engine], allowDeployments: raw })
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["allowDeployments"],
        message: 'CAMUNDA_ALLOW_DEPLOYMENTS must be exactly "true" or "false" (or unset)',
      }),
    ])
  })

  it("configFromEnv only trims (empty = unset) and leaves the verdict to the strict schema", () => {
    const fromEnv = (value?: string) =>
      camunda7Module.configFromEnv({ CAMUNDA_ALLOW_DEPLOYMENTS: value }).allowDeployments
    expect(fromEnv("yes")).toBe("yes")
    expect(fromEnv(" true ")).toBe("true")
    expect(fromEnv("")).toBeUndefined()
    expect(fromEnv("   ")).toBeUndefined()
    expect(camunda7Module.configFromEnv({}).allowDeployments).toBeUndefined()
  })

  it("is a known env var", () => {
    expect(camunda7Module.knownEnvVars).toContain("CAMUNDA_ALLOW_DEPLOYMENTS")
  })

  /** The module's createPlugin → plugin → registrar path, as the composition drives it. */
  const registeredNames = (config: Record<string, unknown>): string[] => {
    const tool = vi.fn()
    const server = { tool, use: vi.fn(), prompt: vi.fn() } as unknown as MCPServer
    camunda7Module.createPlugin({ engines: [engine], ...config }, {}).registerTools?.(server)
    return tool.mock.calls.map((c) => (c[0] as { name: string }).name)
  }

  it("registers camunda7_create_deployment only with the flag AND camunda7:admin", () => {
    const DEPLOY = "camunda7_create_deployment"
    expect(registeredNames({ toolset: "admin", allowDeployments: "true" })).toContain(DEPLOY)
    expect(registeredNames({ toolset: "admin", allowDeployments: "false" })).not.toContain(DEPLOY)
    expect(registeredNames({ toolset: "admin" })).not.toContain(DEPLOY)
    expect(registeredNames({ toolset: "operations", allowDeployments: "true" })).not.toContain(
      DEPLOY,
    )
  })

  it("boots junk loudly through createPlugin, not silently off", () => {
    expect(() => registeredNames({ toolset: "admin", allowDeployments: "on" })).toThrow(
      /CAMUNDA_ALLOW_DEPLOYMENTS/,
    )
  })
})

describe("CAMUNDA_REQUEST_TIMEOUT_MS", () => {
  const engine = { id: "prod-a", baseUrl: "http://engine.example/engine-rest" }
  const parsed = (requestTimeoutMs?: unknown) =>
    camunda7ConfigSchema.parse({ engines: [engine], requestTimeoutMs }).requestTimeoutMs

  it("parses whole milliseconds from env text or a direct caller's number; unset = default", () => {
    expect(parsed("30000")).toBe(30_000)
    expect(parsed("1")).toBe(1)
    expect(parsed(5_000)).toBe(5_000)
    expect(parsed("2147483647")).toBe(2_147_483_647)
    expect(parsed(undefined)).toBeUndefined()
  })

  it.each(["30s", "3e4", "-1", "0", "1.5", "", " 30000", "2147483648", 0, 2.5, -5])(
    "fails the boot on %j, naming the variable",
    (raw) => {
      expect(() => parsed(raw)).toThrow(/CAMUNDA_REQUEST_TIMEOUT_MS/)
    },
  )

  it("configFromEnv trims (empty = unset) and leaves the verdict to the strict schema", () => {
    const fromEnv = (value?: string) =>
      camunda7Module.configFromEnv({ CAMUNDA_REQUEST_TIMEOUT_MS: value }).requestTimeoutMs
    expect(fromEnv(" 5000 ")).toBe("5000")
    expect(fromEnv("30s")).toBe("30s")
    expect(fromEnv("  ")).toBeUndefined()
    expect(fromEnv(undefined)).toBeUndefined()
    expect(camunda7Module.knownEnvVars).toContain("CAMUNDA_REQUEST_TIMEOUT_MS")
  })

  it("reaches every engine client: a junk value fails createPlugin, a valid one boots", () => {
    const server = { tool: vi.fn(), use: vi.fn(), prompt: vi.fn() } as unknown as MCPServer
    expect(() =>
      camunda7Module.createPlugin({ engines: [engine], requestTimeoutMs: "soon" }, {}),
    ).toThrow(/CAMUNDA_REQUEST_TIMEOUT_MS/)
    const plugin = camunda7Module.createPlugin({ engines: [engine], requestTimeoutMs: "250" }, {})
    expect(() => plugin.registerTools?.(server)).not.toThrow()
  })
})

/** The id is the join key against `engine_id`: a mismatch makes engine-scoped analytics empty, not failing. */
describe("camunda7Module.configFromEnv engine ids", () => {
  const enginesOf = (env: NodeJS.ProcessEnv) =>
    camunda7Module.configFromEnv(env).engines as Array<{ id: string; baseUrl: string }>

  it("names the CAMUNDA_BASE_URL shorthand engine after CAMUNDA_ENGINE_ID", () => {
    expect(
      enginesOf({
        CAMUNDA_BASE_URL: "http://engine.example/engine-rest",
        CAMUNDA_ENGINE_ID: "prod-a",
      }),
    ).toEqual([{ id: "prod-a", baseUrl: "http://engine.example/engine-rest" }])
  })

  it('falls back to "default" without CAMUNDA_ENGINE_ID, including the zero-config engine', () => {
    expect(enginesOf({ CAMUNDA_BASE_URL: "http://engine.example/engine-rest" })[0].id).toBe(
      "default",
    )
    expect(enginesOf({})).toEqual([{ id: "default", baseUrl: "http://localhost:8410/engine-rest" }])
    expect(enginesOf({ CAMUNDA_ENGINE_ID: "  " })[0].id).toBe("default")
  })

  it("applies CAMUNDA_ENGINE_ID to the zero-config engine too", () => {
    expect(enginesOf({ CAMUNDA_ENGINE_ID: "prod-a" })[0].id).toBe("prod-a")
  })

  it("ignores CAMUNDA_ENGINE_ID when the engine list is explicit", () => {
    expect(
      enginesOf({
        CAMUNDA_ENGINE_ID: "prod-a",
        CAMUNDA_ENGINES_JSON: '[{"id":"prod-b","baseUrl":"http://b.example/engine-rest"}]',
      }),
    ).toEqual([{ id: "prod-b", baseUrl: "http://b.example/engine-rest" }])
  })

  it("declares CAMUNDA_ENGINE_ID so the unknown-env-var warner does not flag it", () => {
    expect(camunda7Module.knownEnvVars).toContain("CAMUNDA_ENGINE_ID")
  })
})

describe("camunda7Module.configFromEnv environment-map form", () => {
  const enginesOf = (env: NodeJS.ProcessEnv) =>
    camunda7Module.configFromEnv(env).engines as Array<Record<string, unknown>>

  it("stamps the map key as each entry's environment, preserving key order", () => {
    expect(
      enginesOf({
        CAMUNDA_ENGINES_JSON: JSON.stringify({
          "prod-eu": [
            { id: "eu-a", baseUrl: "http://eu-a.example/engine-rest" },
            { id: "eu-b", baseUrl: "http://eu-b.example/engine-rest" },
          ],
          "prod-us": [{ id: "us-a", baseUrl: "http://us-a.example/engine-rest" }],
        }),
      }),
    ).toEqual([
      { id: "eu-a", baseUrl: "http://eu-a.example/engine-rest", environment: "prod-eu" },
      { id: "eu-b", baseUrl: "http://eu-b.example/engine-rest", environment: "prod-eu" },
      { id: "us-a", baseUrl: "http://us-a.example/engine-rest", environment: "prod-us" },
    ])
  })

  it("keeps a matching per-entry environment and rejects a contradicting one", () => {
    const matching = {
      "prod-eu": [
        { id: "eu-a", baseUrl: "http://eu-a.example/engine-rest", environment: "prod-eu" },
      ],
    }
    expect(enginesOf({ CAMUNDA_ENGINES_JSON: JSON.stringify(matching) })[0].environment).toBe(
      "prod-eu",
    )
    const contradicting = {
      "prod-eu": [
        { id: "eu-a", baseUrl: "http://eu-a.example/engine-rest", environment: "prod-us" },
      ],
    }
    expect(() => enginesOf({ CAMUNDA_ENGINES_JSON: JSON.stringify(contradicting) })).toThrow(
      /contradicting environment "prod-us"/,
    )
  })

  it("rejects a map value that is not an engine array", () => {
    expect(() => enginesOf({ CAMUNDA_ENGINES_JSON: '{"prod-eu":{"id":"a"}}' })).toThrow(
      /must map to an ARRAY/,
    )
  })

  it("passes the flat array form through untouched, environment field included", () => {
    const flat = [{ id: "a", baseUrl: "http://a.example/engine-rest", environment: "prod-eu" }]
    expect(enginesOf({ CAMUNDA_ENGINES_JSON: JSON.stringify(flat) })).toEqual(flat)
  })

  it("rejects a duplicate environment key — JSON.parse would silently keep only the last block", () => {
    const duplicated =
      '{"prod-eu":[{"id":"eu-a","baseUrl":"http://eu-a.example/engine-rest"}],' +
      '"prod-us":[{"id":"us-a","baseUrl":"http://us-a.example/engine-rest"}],' +
      '"prod-eu":[{"id":"eu-b","baseUrl":"http://eu-b.example/engine-rest"}]}'
    expect(() => enginesOf({ CAMUNDA_ENGINES_JSON: duplicated })).toThrow(
      /duplicate environment key "prod-eu"/,
    )
  })

  it("only depth-1 keys count as duplicates — repeated engine-entry fields stay legal", () => {
    // Every engine entry repeats "id"/"baseUrl", and the array form has no
    // top-level object keys at all.
    expect(() =>
      enginesOf({
        CAMUNDA_ENGINES_JSON:
          '{"prod-eu":[{"id":"eu-a","baseUrl":"http://eu-a.example/engine-rest"},' +
          '{"id":"eu-b","baseUrl":"http://eu-b.example/engine-rest"}]}',
      }),
    ).not.toThrow()
    expect(() =>
      enginesOf({
        CAMUNDA_ENGINES_JSON:
          '[{"id":"a","baseUrl":"http://a.example/engine-rest"},' +
          '{"id":"b","baseUrl":"http://b.example/engine-rest"}]',
      }),
    ).not.toThrow()
  })
})

/** Zero-config reaches the Compose engine while analytics silently return empty: the warning is the only signal. */
describe("camunda7Module.bootWarnings", () => {
  it("warns on a fully unconfigured environment, naming the fallback URL and id", () => {
    const warnings = camunda7Module.bootWarnings({})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("http://localhost:8410/engine-rest")
    expect(warnings[0]).toContain('engine id "default"')
    expect(warnings[0]).toContain("CAMUNDA_ENGINE_ID")
  })

  it("names the CAMUNDA_ENGINE_ID override in the warning when only the id is set", () => {
    expect(camunda7Module.bootWarnings({ CAMUNDA_ENGINE_ID: "prod-a" })[0]).toContain(
      'engine id "prod-a"',
    )
  })

  it.each([
    { CAMUNDA_BASE_URL: "http://engine.example/engine-rest" },
    { CAMUNDA_ENGINES_JSON: '[{"id":"a","baseUrl":"http://a.example/engine-rest"}]' },
    { CAMUNDA_ENGINES_FILE: "/etc/engines.json" },
  ])("stays silent when an engine source is configured (%o)", (env) => {
    expect(camunda7Module.bootWarnings(env)).toEqual([])
  })

  it.each(["CAMUNDA_ENGINES_FILE", "CAMUNDA_ENGINES_JSON", "CAMUNDA_BASE_URL"])(
    "treats a whitespace-only %s as unset",
    (name) => {
      expect(camunda7Module.bootWarnings({ [name]: "  " })).toHaveLength(1)
    },
  )

  it("names the default id for a whitespace-only CAMUNDA_ENGINE_ID", () => {
    expect(camunda7Module.bootWarnings({ CAMUNDA_ENGINE_ID: "  " })[0]).toContain(
      'engine id "default"',
    )
  })

  it("states the deployment opt-in on every boot: admin-only, code execution in the JVM", () => {
    const configured = { CAMUNDA_BASE_URL: "http://engine.example/engine-rest" }
    const warnings = camunda7Module.bootWarnings({
      ...configured,
      CAMUNDA_ALLOW_DEPLOYMENTS: "true",
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      "CAMUNDA_ALLOW_DEPLOYMENTS=true — camunda7_create_deployment is registered under camunda7:admin",
    )
    expect(warnings[0]).toContain("Deploying a process runs code inside the engine JVM")
    expect(
      camunda7Module.bootWarnings({ ...configured, CAMUNDA_ALLOW_DEPLOYMENTS: "false" }),
    ).toEqual([])
  })

  it.each([" true ", "true\n"])(
    "discloses a padded opt-in (%j) exactly like the value configFromEnv arms",
    (raw) => {
      const env = {
        CAMUNDA_BASE_URL: "http://engine.example/engine-rest",
        CAMUNDA_ALLOW_DEPLOYMENTS: raw,
      }
      expect(camunda7Module.configFromEnv(env).allowDeployments).toBe("true")
      expect(camunda7Module.bootWarnings(env)).toEqual([
        expect.stringContaining("CAMUNDA_ALLOW_DEPLOYMENTS=true"),
      ])
    },
  )

  it("keeps both warnings when the engine is unconfigured AND deployments are on", () => {
    const warnings = camunda7Module.bootWarnings({ CAMUNDA_ALLOW_DEPLOYMENTS: "true" })
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain("No engine is configured")
    expect(warnings[1]).toContain("CAMUNDA_ALLOW_DEPLOYMENTS=true")
  })
})

describe("camunda7Module.configFromEnv passthrough", () => {
  it("maps the auth and repo env vars verbatim", () => {
    expect(
      camunda7Module.configFromEnv({
        CAMUNDA_AUTH_TYPE: "basic",
        CAMUNDA_USERNAME: "u",
        CAMUNDA_PASSWORD: "p",
        CAMUNDA_TOKEN: "t",
        CAMUNDA_INCIDENT_ISSUE_REPO: "acme/procs",
      }),
    ).toMatchObject({
      authType: "basic",
      username: "u",
      password: "p",
      token: "t",
      incidentIssueRepository: "acme/procs",
    })
  })

  it("forwards healthThresholds only when one of the vars is set", () => {
    expect(camunda7Module.configFromEnv({})).not.toHaveProperty("healthThresholds")
    expect(camunda7Module.configFromEnv({ CAMUNDA_HEALTH_CRITICAL_INCIDENTS: "9" })).toMatchObject({
      healthThresholds: { criticalIncidents: "9" },
    })
    expect(
      camunda7Module.configFromEnv({ CAMUNDA_HEALTH_CRITICAL_CLUSTER_SIZE: "4" }),
    ).toMatchObject({ healthThresholds: { criticalClusterSize: "4" } })
  })
})

describe("camunda7ConfigSchema auth validation", () => {
  const engine = { id: "prod-a", baseUrl: "http://engine.example/engine-rest" }

  it("accepts complete basic/bearer credentials", () => {
    expect(() =>
      camunda7ConfigSchema.parse({
        engines: [engine],
        authType: "basic",
        username: "u",
        password: "p",
      }),
    ).not.toThrow()
    expect(() =>
      camunda7ConfigSchema.parse({ engines: [engine], authType: "bearer", token: "t" }),
    ).not.toThrow()
  })

  it("rejects basic without credentials and bearer without token, naming the vars", () => {
    expect(() => camunda7ConfigSchema.parse({ engines: [engine], authType: "basic" })).toThrow(
      /CAMUNDA_USERNAME and CAMUNDA_PASSWORD/,
    )
    expect(() => camunda7ConfigSchema.parse({ engines: [engine], authType: "bearer" })).toThrow(
      /CAMUNDA_TOKEN/,
    )
  })

  it("lets per-engine auth stand in for missing global credentials", () => {
    const withAuth = { ...engine, auth: { type: "none" as const } }
    expect(() =>
      camunda7ConfigSchema.parse({ engines: [withAuth], authType: "basic" }),
    ).not.toThrow()
  })

  it("rejects engine ids that break the metrics-label contract", () => {
    expect(() => camunda7ConfigSchema.parse({ engines: [{ ...engine, id: "Prod A" }] })).toThrow(
      /lowercase/,
    )
  })

  it("holds environment ids to the same lowercase contract", () => {
    expect(() =>
      camunda7ConfigSchema.parse({ engines: [{ ...engine, environment: "Prod EU" }] }),
    ).toThrow(/lowercase/)
    expect(() =>
      camunda7ConfigSchema.parse({ engines: [{ ...engine, environment: "prod-eu" }] }),
    ).not.toThrow()
  })

  it("rejects purely numeric environment ids — JS object enumeration would reorder them first", () => {
    expect(() =>
      camunda7ConfigSchema.parse({ engines: [{ ...engine, environment: "2" }] }),
    ).toThrow(/purely numeric/)
    // A digit-leading id with a non-digit is not an array-index key — stays legal.
    expect(() =>
      camunda7ConfigSchema.parse({ engines: [{ ...engine, environment: "2nd-region" }] }),
    ).not.toThrow()
  })

  it("rejects duplicate engine ids across environments — the id stays the flat join key", () => {
    expect(() =>
      camunda7ConfigSchema.parse({
        engines: [
          { ...engine, environment: "prod-eu" },
          { ...engine, environment: "prod-us" },
        ],
      }),
    ).toThrow(/unique across all environments/)
  })
})
