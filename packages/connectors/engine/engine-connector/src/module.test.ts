import { afterEach, describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import { engineModule, engineConfigSchema } from "./module.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("engineModule.toolsets (fail-closed policy)", () => {
  const vocabulary = engineModule.toolsets

  it("declares its toolset vocabulary", () => {
    expect(vocabulary.module).toBe("engine")
    expect(vocabulary.names).toEqual(["read-only", "operations", "admin"])
    expect(vocabulary.fallback).toBe("read-only")
    expect(vocabulary.authenticatedDefault).toBe("operations")
  })

  it("no suffix: read-only without OAuth, operations with it, never admin", () => {
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
})

/** Deploying is code execution in the engine JVM, so a typo fails the boot (`z.coerce.boolean` reads "false" as true). */
describe("ENGINE_ALLOW_DEPLOYMENTS", () => {
  const engine = { id: "prod-a", baseUrl: "http://engine.example/engine-rest" }
  const parsedFlag = (allowDeployments?: string) =>
    engineConfigSchema.parse({ engines: [engine], allowDeployments }).allowDeployments

  it('parses "true" to true and "false" / unset to false', () => {
    expect(parsedFlag("true")).toBe(true)
    expect(parsedFlag("false")).toBe(false)
    expect(parsedFlag(undefined)).toBe(false)
    expect(engineConfigSchema.parse({ engines: [engine] }).allowDeployments).toBe(false)
  })

  it.each(["yes", "1", "TRUE", " true", ""])("fails the boot on %j, naming the variable", (raw) => {
    expect(() => parsedFlag(raw)).toThrow(/ENGINE_ALLOW_DEPLOYMENTS/)
    const result = engineConfigSchema.safeParse({ engines: [engine], allowDeployments: raw })
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ["allowDeployments"],
        message: 'ENGINE_ALLOW_DEPLOYMENTS must be exactly "true" or "false" (or unset)',
      }),
    ])
  })

  it("configFromEnv trims (empty = unset), keeps the text and refuses junk, naming the variable", () => {
    const fromEnv = (value?: string) =>
      engineModule.configFromEnv({ ENGINE_ALLOW_DEPLOYMENTS: value }).allowDeployments
    expect(fromEnv(" true ")).toBe("true")
    expect(fromEnv("")).toBeUndefined()
    expect(fromEnv("   ")).toBeUndefined()
    expect(engineModule.configFromEnv({}).allowDeployments).toBeUndefined()
    expect(() => fromEnv("yes")).toThrow(
      'ENGINE_ALLOW_DEPLOYMENTS must be exactly "true" or "false" (or unset)',
    )
  })

  it("is a known env var", () => {
    expect(engineModule.knownEnvVars).toContain("ENGINE_ALLOW_DEPLOYMENTS")
  })

  /** The module's createPlugin → plugin → registrar path, as the composition drives it. */
  const registeredNames = (config: Record<string, unknown>): string[] => {
    const tool = vi.fn()
    const server = { tool, prompt: vi.fn() } as unknown as MCPServer
    engineModule.createPlugin({ engines: [engine], ...config }).register(server)
    return tool.mock.calls.map((c) => (c[0] as { name: string }).name)
  }

  it("registers engine_create_deployment only with the flag AND engine:admin", () => {
    const DEPLOY = "engine_create_deployment"
    expect(registeredNames({ toolset: "admin", allowDeployments: "true" })).toContain(DEPLOY)
    expect(registeredNames({ toolset: "admin", allowDeployments: "false" })).not.toContain(DEPLOY)
    expect(registeredNames({ toolset: "admin" })).not.toContain(DEPLOY)
    expect(registeredNames({ toolset: "operations", allowDeployments: "true" })).not.toContain(
      DEPLOY,
    )
  })

  it("boots junk loudly through createPlugin, not silently off", () => {
    expect(() => registeredNames({ toolset: "admin", allowDeployments: "on" })).toThrow(
      /ENGINE_ALLOW_DEPLOYMENTS/,
    )
  })
})

describe("ENGINE_REQUEST_TIMEOUT_MS", () => {
  const engine = { id: "prod-a", baseUrl: "http://engine.example/engine-rest" }
  const parsed = (requestTimeoutMs?: unknown) =>
    engineConfigSchema.parse({ engines: [engine], requestTimeoutMs }).requestTimeoutMs

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
      expect(() => parsed(raw)).toThrow(/ENGINE_REQUEST_TIMEOUT_MS/)
    },
  )

  it("configFromEnv trims (empty = unset), keeps the text and refuses junk, naming the variable", () => {
    const fromEnv = (value?: string) =>
      engineModule.configFromEnv({ ENGINE_REQUEST_TIMEOUT_MS: value }).requestTimeoutMs
    expect(fromEnv(" 5000 ")).toBe("5000")
    expect(() => fromEnv("30s")).toThrow(
      "ENGINE_REQUEST_TIMEOUT_MS must be a whole number of milliseconds",
    )
    expect(fromEnv("  ")).toBeUndefined()
    expect(fromEnv(undefined)).toBeUndefined()
    expect(engineModule.knownEnvVars).toContain("ENGINE_REQUEST_TIMEOUT_MS")
  })

  it("reaches every engine client: a junk value fails createPlugin, a valid one boots", () => {
    const server = { tool: vi.fn(), prompt: vi.fn() } as unknown as MCPServer
    expect(() =>
      engineModule.createPlugin({ engines: [engine], requestTimeoutMs: "soon" }),
    ).toThrow(/ENGINE_REQUEST_TIMEOUT_MS/)
    const plugin = engineModule.createPlugin({ engines: [engine], requestTimeoutMs: "250" })
    expect(() => plugin.register(server)).not.toThrow()
  })
})

/** The id is the join key against `engine_id`: a mismatch makes engine-scoped analytics empty, not failing. */
describe("engineModule.configFromEnv engine ids", () => {
  const enginesOf = (env: NodeJS.ProcessEnv) =>
    engineModule.configFromEnv(env).engines as Array<{ id: string; baseUrl: string }>

  it("names the ENGINE_BASE_URL shorthand engine after ENGINE_ID", () => {
    expect(
      enginesOf({
        ENGINE_BASE_URL: "http://engine.example/engine-rest",
        ENGINE_ID: "prod-a",
      }),
    ).toEqual([{ id: "prod-a", baseUrl: "http://engine.example/engine-rest" }])
  })

  it('falls back to "default" without ENGINE_ID, including the zero-config engine', () => {
    expect(enginesOf({ ENGINE_BASE_URL: "http://engine.example/engine-rest" })[0].id).toBe(
      "default",
    )
    expect(enginesOf({})).toEqual([{ id: "default", baseUrl: "http://localhost:8410/engine-rest" }])
    expect(enginesOf({ ENGINE_ID: "  " })[0].id).toBe("default")
  })

  it("applies ENGINE_ID to the zero-config engine too", () => {
    expect(enginesOf({ ENGINE_ID: "prod-a" })[0].id).toBe("prod-a")
  })

  it("ignores ENGINE_ID when the engine list is explicit", () => {
    expect(
      enginesOf({
        ENGINE_ID: "prod-a",
        ENGINES_JSON: '[{"id":"prod-b","baseUrl":"http://b.example/engine-rest"}]',
      }),
    ).toEqual([{ id: "prod-b", baseUrl: "http://b.example/engine-rest" }])
  })

  it("declares ENGINE_ID so the unknown-env-var warner does not flag it", () => {
    expect(engineModule.knownEnvVars).toContain("ENGINE_ID")
  })
})

describe("engineModule.configFromEnv environment-map form", () => {
  const enginesOf = (env: NodeJS.ProcessEnv) =>
    engineModule.configFromEnv(env).engines as Array<Record<string, unknown>>

  it("stamps the map key as each entry's environment, preserving key order", () => {
    expect(
      enginesOf({
        ENGINES_JSON: JSON.stringify({
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
    expect(enginesOf({ ENGINES_JSON: JSON.stringify(matching) })[0].environment).toBe("prod-eu")
    const contradicting = {
      "prod-eu": [
        { id: "eu-a", baseUrl: "http://eu-a.example/engine-rest", environment: "prod-us" },
      ],
    }
    expect(() => enginesOf({ ENGINES_JSON: JSON.stringify(contradicting) })).toThrow(
      /contradicting environment "prod-us"/,
    )
  })

  it("rejects a map value that is not an engine array", () => {
    expect(() => enginesOf({ ENGINES_JSON: '{"prod-eu":{"id":"a"}}' })).toThrow(
      /must map to an ARRAY/,
    )
  })

  it("passes the flat array form through untouched, environment field included", () => {
    const flat = [{ id: "a", baseUrl: "http://a.example/engine-rest", environment: "prod-eu" }]
    expect(enginesOf({ ENGINES_JSON: JSON.stringify(flat) })).toEqual(flat)
  })

  it("rejects a duplicate environment key: JSON.parse would silently keep only the last block", () => {
    const duplicated =
      '{"prod-eu":[{"id":"eu-a","baseUrl":"http://eu-a.example/engine-rest"}],' +
      '"prod-us":[{"id":"us-a","baseUrl":"http://us-a.example/engine-rest"}],' +
      '"prod-eu":[{"id":"eu-b","baseUrl":"http://eu-b.example/engine-rest"}]}'
    expect(() => enginesOf({ ENGINES_JSON: duplicated })).toThrow(
      /duplicate environment key "prod-eu"/,
    )
  })

  it("only depth-1 keys count as duplicates; repeated engine-entry fields stay legal", () => {
    // Every engine entry repeats "id"/"baseUrl", and the array form has no
    // top-level object keys at all.
    expect(() =>
      enginesOf({
        ENGINES_JSON:
          '{"prod-eu":[{"id":"eu-a","baseUrl":"http://eu-a.example/engine-rest"},' +
          '{"id":"eu-b","baseUrl":"http://eu-b.example/engine-rest"}]}',
      }),
    ).not.toThrow()
    expect(() =>
      enginesOf({
        ENGINES_JSON:
          '[{"id":"a","baseUrl":"http://a.example/engine-rest"},' +
          '{"id":"b","baseUrl":"http://b.example/engine-rest"}]',
      }),
    ).not.toThrow()
  })
})

/** Zero-config reaches a local CIB seven while analytics silently return empty: the warning is the only signal. */
describe("engineModule.bootWarnings", () => {
  it("warns on a fully unconfigured environment, naming the fallback URL and id", () => {
    const warnings = engineModule.bootWarnings({})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("http://localhost:8410/engine-rest")
    expect(warnings[0]).toContain('engine id "default"')
    expect(warnings[0]).toContain("ENGINE_ID")
  })

  // The warning ships to every server built on the package, a starter's too: it names the two
  // engines that answer on :8410 by their repositories, never "the repo's" stack.
  it("names the engines the fallback URL reaches: the starter's compose.yaml and the playground", () => {
    const [warning] = engineModule.bootWarnings({})
    expect(warning).toContain("the Pulse starter's compose.yaml (Miragon/pulse-starter)")
    expect(warning).toContain("the Pulse playground (Miragon/pulse)")
    expect(warning).toContain('the playground\'s engine stamps "prod-a"')
    // A zero-config boot sends no login, which the starter's engine refuses with 401.
    expect(warning).toContain("the starter's asks for a login (ENGINE_AUTH_TYPE=basic, demo/demo)")
    expect(warning).not.toMatch(/the repo's/i)
  })

  it("names the ENGINE_ID override in the warning when only the id is set", () => {
    expect(engineModule.bootWarnings({ ENGINE_ID: "prod-a" })[0]).toContain('engine id "prod-a"')
  })

  it.each([
    { ENGINE_BASE_URL: "http://engine.example/engine-rest" },
    { ENGINES_JSON: '[{"id":"a","baseUrl":"http://a.example/engine-rest"}]' },
    { ENGINES_FILE: "/etc/engines.json" },
  ])("stays silent when an engine source is configured (%o)", (env) => {
    expect(engineModule.bootWarnings(env)).toEqual([])
  })

  it.each(["ENGINES_FILE", "ENGINES_JSON", "ENGINE_BASE_URL"])(
    "treats a whitespace-only %s as unset",
    (name) => {
      expect(engineModule.bootWarnings({ [name]: "  " })).toHaveLength(1)
    },
  )

  it("names the default id for a whitespace-only ENGINE_ID", () => {
    expect(engineModule.bootWarnings({ ENGINE_ID: "  " })[0]).toContain('engine id "default"')
  })

  it("states the deployment opt-in on every boot: admin-only, code execution in the JVM", () => {
    const configured = { ENGINE_BASE_URL: "http://engine.example/engine-rest" }
    const warnings = engineModule.bootWarnings({
      ...configured,
      ENGINE_ALLOW_DEPLOYMENTS: "true",
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      "ENGINE_ALLOW_DEPLOYMENTS=true: engine_create_deployment is registered under engine:admin",
    )
    expect(warnings[0]).toContain("Deploying a process runs code inside the engine JVM")
    expect(engineModule.bootWarnings({ ...configured, ENGINE_ALLOW_DEPLOYMENTS: "false" })).toEqual(
      [],
    )
  })

  it.each([" true ", "true\n"])(
    "discloses a padded opt-in (%j) exactly like the value configFromEnv arms",
    (raw) => {
      const env = {
        ENGINE_BASE_URL: "http://engine.example/engine-rest",
        ENGINE_ALLOW_DEPLOYMENTS: raw,
      }
      expect(engineModule.configFromEnv(env).allowDeployments).toBe("true")
      expect(engineModule.bootWarnings(env)).toEqual([
        expect.stringContaining("ENGINE_ALLOW_DEPLOYMENTS=true"),
      ])
    },
  )

  it("keeps both warnings when the engine is unconfigured AND deployments are on", () => {
    const warnings = engineModule.bootWarnings({ ENGINE_ALLOW_DEPLOYMENTS: "true" })
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain("No engine is configured")
    expect(warnings[1]).toContain("ENGINE_ALLOW_DEPLOYMENTS=true")
  })
})

describe("engineModule.configFromEnv passthrough", () => {
  it("maps the auth and repo env vars verbatim", () => {
    expect(
      engineModule.configFromEnv({
        ENGINE_AUTH_TYPE: "basic",
        ENGINE_USERNAME: "u",
        ENGINE_PASSWORD: "p",
        ENGINE_TOKEN: "t",
        ENGINE_INCIDENT_ISSUE_REPO: "acme/procs",
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
    expect(engineModule.configFromEnv({})).not.toHaveProperty("healthThresholds")
    expect(engineModule.configFromEnv({ ENGINE_HEALTH_CRITICAL_INCIDENTS: "9" })).toMatchObject({
      healthThresholds: { criticalIncidents: "9" },
    })
    expect(engineModule.configFromEnv({ ENGINE_HEALTH_CRITICAL_CLUSTER_SIZE: "4" })).toMatchObject({
      healthThresholds: { criticalClusterSize: "4" },
    })
  })
})

describe("engineConfigSchema auth validation", () => {
  const engine = { id: "prod-a", baseUrl: "http://engine.example/engine-rest" }

  it("accepts complete basic/bearer credentials", () => {
    expect(() =>
      engineConfigSchema.parse({
        engines: [engine],
        authType: "basic",
        username: "u",
        password: "p",
      }),
    ).not.toThrow()
    expect(() =>
      engineConfigSchema.parse({ engines: [engine], authType: "bearer", token: "t" }),
    ).not.toThrow()
  })

  it("rejects basic without credentials and bearer without token, naming the vars", () => {
    expect(() => engineConfigSchema.parse({ engines: [engine], authType: "basic" })).toThrow(
      /ENGINE_USERNAME and ENGINE_PASSWORD/,
    )
    expect(() => engineConfigSchema.parse({ engines: [engine], authType: "bearer" })).toThrow(
      /ENGINE_TOKEN/,
    )
  })

  it("lets per-engine auth stand in for missing global credentials", () => {
    const withAuth = { ...engine, auth: { type: "none" as const } }
    expect(() => engineConfigSchema.parse({ engines: [withAuth], authType: "basic" })).not.toThrow()
  })

  it("rejects engine ids that break the metrics-label contract", () => {
    expect(() => engineConfigSchema.parse({ engines: [{ ...engine, id: "Prod A" }] })).toThrow(
      /lowercase/,
    )
  })

  it("holds environment ids to the same lowercase contract", () => {
    expect(() =>
      engineConfigSchema.parse({ engines: [{ ...engine, environment: "Prod EU" }] }),
    ).toThrow(/lowercase/)
    expect(() =>
      engineConfigSchema.parse({ engines: [{ ...engine, environment: "prod-eu" }] }),
    ).not.toThrow()
  })

  it("rejects purely numeric environment ids: JS object enumeration would reorder them first", () => {
    expect(() => engineConfigSchema.parse({ engines: [{ ...engine, environment: "2" }] })).toThrow(
      /purely numeric/,
    )
    // A digit-leading id with a non-digit is not an array-index key, so it stays legal.
    expect(() =>
      engineConfigSchema.parse({ engines: [{ ...engine, environment: "2nd-region" }] }),
    ).not.toThrow()
  })

  it("rejects duplicate engine ids across environments: the id stays the flat join key", () => {
    expect(() =>
      engineConfigSchema.parse({
        engines: [
          { ...engine, environment: "prod-eu" },
          { ...engine, environment: "prod-us" },
        ],
      }),
    ).toThrow(/unique across all environments/)
  })
})
