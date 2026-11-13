import { afterEach, describe, expect, it, vi } from "vitest"
import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
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
    const recording = recordingModuleServer()
    engineModule.createPlugin({ engines: [engine], ...config }).register(recording.server)
    return [...recording.tools.keys()]
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
    const { server } = recordingModuleServer()
    expect(() =>
      engineModule.createPlugin({ engines: [engine], requestTimeoutMs: "soon" }),
    ).toThrow(/ENGINE_REQUEST_TIMEOUT_MS/)
    const plugin = engineModule.createPlugin({ engines: [engine], requestTimeoutMs: "250" })
    expect(() => plugin.register(server)).not.toThrow()
  })
})

/** The id is the per-call `engine` selector, the name the cockpit shows and the id the hand-offs name. */
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

  it("applies ENGINE_ID to the zero-config engine too, a profile name of any valid shape", () => {
    expect(enginesOf({ ENGINE_ID: "prod-a" })[0].id).toBe("prod-a")
    expect(enginesOf({ ENGINE_ID: "Prod_A.eu" })[0].id).toBe("Prod_A.eu")
  })

  it("ignores ENGINE_ID when a profile file describes the engines", () => {
    expect(
      enginesOf({
        ENGINE_ID: "prod-a",
        ENGINES_JSON: '{"profiles":{"prod-b":{"url":"http://b.example/engine-rest"}}}',
      }),
    ).toEqual([{ id: "prod-b", baseUrl: "http://b.example/engine-rest" }])
  })

  it("declares ENGINE_ID so the unknown-env-var warner does not flag it", () => {
    expect(engineModule.knownEnvVars).toContain("ENGINE_ID")
  })
})

describe("engineModule.configFromEnv profiles: environment and names", () => {
  const configOf = (json: string) => engineModule.configFromEnv({ ENGINES_JSON: json })

  it("takes each profile's environment, in the order of the file", () => {
    expect(
      configOf(
        JSON.stringify({
          profiles: {
            "eu-a": { url: "http://eu-a.example/engine-rest", environment: "prod-eu" },
            "eu-b": { url: "http://eu-b.example/engine-rest", environment: "prod-eu" },
            "us-a": { url: "http://us-a.example/engine-rest", environment: "prod-us" },
          },
        }),
      ).engines,
    ).toEqual([
      { id: "eu-a", baseUrl: "http://eu-a.example/engine-rest", environment: "prod-eu" },
      { id: "eu-b", baseUrl: "http://eu-b.example/engine-rest", environment: "prod-eu" },
      { id: "us-a", baseUrl: "http://us-a.example/engine-rest", environment: "prod-us" },
    ])
  })

  it("refuses a profile whose environment is no lower-case id, and runs the others", () => {
    const config = configOf(
      JSON.stringify({
        profiles: {
          a: { url: "http://a.example/engine-rest", environment: "Prod EU" },
          b: { url: "http://b.example/engine-rest", environment: "2" },
        },
      }),
    )
    expect((config.engines as Array<{ id: string }>).map(({ id }) => id)).toEqual(["b"])
    expect(config.refused).toEqual([
      {
        id: "a",
        reason:
          'environment must be an environment id: lower case letters, digits and "-", starting with a letter or digit.',
      },
    ])
  })

  it("refuses a name the file lists twice: JSON would keep only the last one", () => {
    const config = configOf(
      '{"profiles":{"a":{"url":"http://a1/engine-rest"},"b":{"url":"http://b/engine-rest"},' +
        '"a":{"url":"http://a2/engine-rest"}}}',
    )
    expect((config.engines as Array<{ id: string }>).map(({ id }) => id)).toEqual(["b"])
    expect(config.refused).toEqual([
      {
        id: "a",
        reason:
          "The file lists this profile name twice: JSON keeps only the last one, so neither counts.",
      },
    ])
    expect(config.engineIds).toEqual(["a", "b"])
    expect(config.profileCount).toBe(2)
  })
})

/** Zero-config reaches a local CIB seven on the fallback URL: the warning is the only signal of where. */
describe("engineModule.bootWarnings", () => {
  it("warns on a fully unconfigured environment, naming the fallback URL and id", () => {
    const warnings = engineModule.bootWarnings({})
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("http://localhost:8410/engine-rest")
    expect(warnings[0]).toContain('engine id "default"')
    // No metrics label joins the id any more: the warning sends no one to match it.
    expect(warnings[0]).not.toMatch(/analytics|metrics|engine_id|stamps/)
  })

  // The warning ships to every server built on the package, a starter's too: it names the two
  // engines that answer on :8410 by their repositories, never "the repo's" stack.
  it("names the engines the fallback URL reaches: the starter's compose.yaml and the playground", () => {
    const [warning] = engineModule.bootWarnings({})
    expect(warning).toContain("the Pulse starter's compose.yaml (Miragon/pulse-starter)")
    expect(warning).toContain("the Pulse playground (Miragon/pulse)")
    // A zero-config boot sends no login, which the starter's engine refuses with 401.
    expect(warning).toContain("the starter's asks for a login (ENGINE_AUTH_TYPE=basic, demo/demo)")
    expect(warning).not.toMatch(/the repo's/i)
  })

  it("names the ENGINE_ID override in the warning when only the id is set", () => {
    expect(engineModule.bootWarnings({ ENGINE_ID: "prod-a" })[0]).toContain('engine id "prod-a"')
  })

  it.each([
    { ENGINE_BASE_URL: "http://engine.example/engine-rest" },
    { ENGINES_JSON: '{"profiles":{"a":{"url":"http://a.example/engine-rest"}}}' },
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

  it("names the single engine's settings a profile file makes meaningless", () => {
    const warnings = engineModule.bootWarnings({
      ENGINES_JSON: '{"profiles":{"a":{"url":"http://a.example/engine-rest"}}}',
      ENGINE_BASE_URL: "http://other/engine-rest",
      ENGINE_AUTH_TYPE: "basic",
      ENGINE_PASSWORD: "pw",
      ENGINE_DEFAULT: "a",
    })
    expect(warnings).toEqual([
      'ENGINE_BASE_URL, ENGINE_AUTH_TYPE, ENGINE_PASSWORD are set next to ENGINES_JSON and ignored: they describe the single engine, which a profile file replaces. A profile states its own url and auth, for example {"url": "…", "auth": {"type": "basic", "username": "…", "passwordEnv": "ENGINE_SECRET_PASSWORD"}}.',
    ])
    expect(
      engineModule.bootWarnings({ ENGINES_FILE: "/etc/engines.json", ENGINE_ID: "x" })[0],
    ).toMatch(/^ENGINE_ID is set next to ENGINES_FILE and ignored/)
  })

  it("names each refused profile and the notes on the file, and nothing on a file that fails", () => {
    const warnings = engineModule.bootWarnings({
      ENGINES_JSON: JSON.stringify({
        engines: [],
        profiles: { a: { url: "http://a.example/engine-rest" }, b: { headers: {} } },
      }),
    })
    expect(warnings).toEqual([
      "ENGINES_JSON: engines is no key of a profile file, which holds $schema, defaultProfile and profiles.",
      expect.stringMatching(/^Profile "b" \(ENGINES_JSON\) is refused: /),
    ])
    expect(engineModule.bootWarnings({ ENGINES_JSON: "[]" })).toEqual([])
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

describe("engineModule.configFromEnv settings", () => {
  it("hands each engine its own auth and keeps no module-wide credentials", () => {
    const config = engineModule.configFromEnv({
      ENGINE_AUTH_TYPE: "basic",
      ENGINE_USERNAME: "u",
      ENGINE_PASSWORD: "p",
      ENGINE_TOKEN: "t",
      ENGINE_INCIDENT_ISSUE_REPO: "acme/procs",
    })
    expect(config).toMatchObject({
      engines: [{ id: "default", auth: { type: "basic", username: "u", password: "p" } }],
      incidentIssueRepository: "acme/procs",
    })
    for (const key of ["authType", "username", "password", "token"]) {
      expect(config).not.toHaveProperty(key)
    }
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

  it("names the ENGINE_SECRET_ variables the profiles reference, for the typo warner", () => {
    const json = JSON.stringify({
      profiles: {
        a: {
          url: "http://a.example/engine-rest",
          auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_A_TOKEN" },
        },
      },
    })
    expect(engineModule.referencedEnvVars({ ENGINES_JSON: json })).toEqual([
      "ENGINE_SECRET_A_TOKEN",
    ])
  })
})

describe("engineConfigSchema holds what configFromEnv hands on", () => {
  const engine = { id: "prod-a", baseUrl: "http://engine.example/engine-rest" }

  it("an engine needs an id and its REST root, a refused profile an id and its reason", () => {
    expect(() => engineConfigSchema.parse({ engines: [engine] })).not.toThrow()
    expect(() => engineConfigSchema.parse({ engines: [] })).toThrow(/Names no engine/)
    expect(() => engineConfigSchema.parse({ engines: [{ id: "a" }] })).toThrow(/baseUrl/)
    expect(() => engineConfigSchema.parse({ engines: [engine], refused: [{ id: "b" }] })).toThrow(
      /the reason/,
    )
  })
})
