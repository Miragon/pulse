import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { frameworkWritesAllowed } from "@miragon/pulse-widget-shell/server"
import {
  composition,
  emitBootWarnings,
  getAppConfig,
  getPlugins,
  logEffectiveToolsets,
  resolveBoot,
  warnUnknownEnvVars,
} from "../src/setup.js"
import { createApp } from "../src/app.js"
import { createTestRuntime } from "./boot-server.js"
import { REPO_ROOT, scanSources } from "./source-scan.js"

const FILE_ENGINES = [{ id: "from-file", baseUrl: "http://file.example/engine-rest" }]
const JSON_ENGINES = [{ id: "from-json", baseUrl: "http://json.example/engine-rest" }]

/** Engines the camunda7 module would boot with, as resolved from the current env. */
function configuredEngines(): unknown {
  const entry = getAppConfig().activeApps.find((e) => e.app === "camunda7")
  expect(entry, "camunda7 module should be active").toBeDefined()
  return (entry!.config as { engines?: unknown }).engines
}

describe("setup.ts engine resolution precedence (ENGINES_FILE > ENGINES_JSON > BASE_URL > default)", () => {
  let tmpDir: string | undefined

  function writeEnginesFile(engines: unknown): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-server-camunda7-engines-"))
    const file = path.join(tmpDir, "engines.json")
    fs.writeFileSync(file, JSON.stringify(engines))
    return file
  }

  beforeEach(() => {
    // Neutral baseline so ambient shell env can't leak into the assertions.
    vi.stubEnv("MCP_ACTIVE_MODULES", undefined)
    vi.stubEnv("CAMUNDA_ENGINES_FILE", undefined)
    vi.stubEnv("CAMUNDA_ENGINES_JSON", undefined)
    vi.stubEnv("CAMUNDA_BASE_URL", undefined)
    vi.stubEnv("CAMUNDA_COCKPIT_URL", undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  })

  it("prefers CAMUNDA_ENGINES_FILE over ENGINES_JSON and BASE_URL", () => {
    vi.stubEnv("CAMUNDA_ENGINES_FILE", writeEnginesFile(FILE_ENGINES))
    vi.stubEnv("CAMUNDA_ENGINES_JSON", JSON.stringify(JSON_ENGINES))
    vi.stubEnv("CAMUNDA_BASE_URL", "http://engine.example/engine-rest")

    expect(configuredEngines()).toEqual(FILE_ENGINES)
  })

  it("prefers CAMUNDA_ENGINES_JSON over BASE_URL when no file is set", () => {
    vi.stubEnv("CAMUNDA_ENGINES_JSON", JSON.stringify(JSON_ENGINES))
    vi.stubEnv("CAMUNDA_BASE_URL", "http://engine.example/engine-rest")

    expect(configuredEngines()).toEqual(JSON_ENGINES)
  })

  it("synthesizes a single `default` engine from the CAMUNDA_BASE_URL shorthand (+ cockpit URL)", () => {
    vi.stubEnv("CAMUNDA_BASE_URL", "http://engine.example/engine-rest")
    vi.stubEnv("CAMUNDA_COCKPIT_URL", "http://engine.example/camunda")

    expect(configuredEngines()).toEqual([
      {
        id: "default",
        baseUrl: "http://engine.example/engine-rest",
        cockpitUrl: "http://engine.example/camunda",
      },
    ])
  })

  it("omits cockpitUrl when only CAMUNDA_BASE_URL is set", () => {
    vi.stubEnv("CAMUNDA_BASE_URL", "http://engine.example/engine-rest")

    expect(configuredEngines()).toEqual([
      { id: "default", baseUrl: "http://engine.example/engine-rest" },
    ])
  })

  it("falls back to the local default engine when nothing is set", () => {
    expect(configuredEngines()).toEqual([
      { id: "default", baseUrl: "http://localhost:8410/engine-rest" },
    ])
  })

  it("treats whitespace-only values as unset when resolving precedence", () => {
    vi.stubEnv("CAMUNDA_ENGINES_FILE", "   ")
    vi.stubEnv("CAMUNDA_ENGINES_JSON", JSON.stringify(JSON_ENGINES))

    expect(configuredEngines()).toEqual(JSON_ENGINES)
  })

  it("accepts the environment-map form in both JSON sources, stamping each key as environment", () => {
    const asMap = {
      "prod-eu": [{ id: "eu-a", baseUrl: "http://eu-a.example/engine-rest" }],
      "prod-us": [{ id: "us-a", baseUrl: "http://us-a.example/engine-rest" }],
    }
    const flattened = [
      { id: "eu-a", baseUrl: "http://eu-a.example/engine-rest", environment: "prod-eu" },
      { id: "us-a", baseUrl: "http://us-a.example/engine-rest", environment: "prod-us" },
    ]
    vi.stubEnv("CAMUNDA_ENGINES_JSON", JSON.stringify(asMap))
    expect(configuredEngines()).toEqual(flattened)

    vi.stubEnv("CAMUNDA_ENGINES_FILE", writeEnginesFile(asMap))
    expect(configuredEngines()).toEqual(flattened)
  })
})

describe("setup.ts MCP_ACTIVE_MODULES module:toolset syntax", () => {
  beforeEach(() => {
    vi.stubEnv("CAMUNDA_ENGINES_FILE", undefined)
    vi.stubEnv("CAMUNDA_ENGINES_JSON", undefined)
    vi.stubEnv("CAMUNDA_BASE_URL", undefined)
    vi.stubEnv("CAMUNDA_COCKPIT_URL", undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  function activeApps() {
    return getAppConfig().activeApps
  }

  it("threads the suffix into the camunda7 config and the default into the suffix-less analytics", () => {
    vi.stubEnv("MCP_ACTIVE_MODULES", "camunda7:operations,analytics")

    const camunda7 = activeApps().find((e) => e.app === "camunda7")
    expect(camunda7?.config).toMatchObject({ toolset: "operations" })
    const analytics = activeApps().find((e) => e.app === "analytics")
    expect(analytics?.config).toMatchObject({ toolset: "read-only" })
  })

  it("activates all modules on their read-only floor when MCP_ACTIVE_MODULES is unset (no OAuth)", () => {
    vi.stubEnv("MCP_ACTIVE_MODULES", undefined)

    const apps = activeApps()
    expect(apps.map((e) => e.app).sort()).toEqual(["analytics", "camunda7"])
    for (const entry of apps) {
      expect(entry.config).toMatchObject({ toolset: "read-only" })
    }
  })

  it("defaults to each module's standard toolset under OAuth — never admin", () => {
    vi.stubEnv("MCP_ACTIVE_MODULES", undefined)

    const boot = resolveBoot({ authenticated: true })
    expect(Object.fromEntries(boot.entries.map((e) => [e.app, e.config.toolset]))).toEqual({
      camunda7: "operations",
      analytics: "standard",
    })
    expect(getAppConfig(boot).activeApps).toBe(boot.entries)
  })

  it.each(["camunda7:", "camunda7: ", "camunda7:bogus", "camunda7:admin:read-only"])(
    "fails an empty or unknown suffix (%j) closed to read-only, even under OAuth",
    (value) => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      vi.stubEnv("MCP_ACTIVE_MODULES", value)

      const [camunda7] = resolveBoot({ authenticated: true }).entries
      expect(camunda7.config).toMatchObject({ toolset: "read-only" })
    },
  )

  it("logs the effective toolsets in one info line", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    vi.stubEnv("MCP_ACTIVE_MODULES", "camunda7:admin,analytics")

    expect(logEffectiveToolsets(resolveBoot())).toBe(
      "[pulse] Toolsets — camunda7:admin (suffix), analytics:read-only (default without OAuth)",
    )
    expect(info).toHaveBeenCalledTimes(1)
  })

  it("createApp derives the selection from the provider ACTUALLY built from MCP_OAUTH", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.stubEnv("MCP_ACTIVE_MODULES", undefined)
    vi.stubEnv("MCP_URL", "https://mcp.example.com")
    const boot = async (raw: string | undefined) => {
      vi.stubEnv("MCP_OAUTH", raw)
      const { boot: selection, builder } = await createApp(process.env, {
        runtime: createTestRuntime(),
        bundle: { jsPath: path.join(import.meta.dirname, "fixtures", "mcp-app.js") },
      })
      const toolsets = Object.fromEntries(selection.entries.map((e) => [e.app, e.config.toolset]))
      return { toolsets, builder }
    }

    // Unset or blank MCP_OAUTH builds no provider → unauthenticated defaults.
    for (const raw of [undefined, "", "   "]) {
      expect(await boot(raw)).toEqual({
        toolsets: { camunda7: "read-only", analytics: "read-only" },
        builder: false,
      })
    }

    const keycloak = JSON.stringify({
      provider: "keycloak",
      serverUrl: "https://kc.example.com",
      realm: "r",
    })
    expect(await boot(keycloak)).toEqual({
      toolsets: { camunda7: "operations", analytics: "standard" },
      builder: true,
    })
  })

  it("fails the boot when OAuth is installed without MCP_URL (no token audience)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.stubEnv("MCP_URL", undefined)
    vi.stubEnv(
      "MCP_OAUTH",
      JSON.stringify({ provider: "keycloak", serverUrl: "https://kc.example.com", realm: "r" }),
    )
    await expect(createApp(process.env, { runtime: createTestRuntime() })).rejects.toThrow(
      /OAuth needs MCP_URL/,
    )
  })

  it("enables the dashboard builder only under OAuth with no read-only module", () => {
    vi.stubEnv("MCP_ACTIVE_MODULES", undefined)
    expect(frameworkWritesAllowed(resolveBoot())).toBe(false)
    expect(frameworkWritesAllowed(resolveBoot({ authenticated: true }))).toBe(true)

    vi.stubEnv("MCP_ACTIVE_MODULES", "camunda7:admin,analytics:read-only")
    expect(frameworkWritesAllowed(resolveBoot({ authenticated: true }))).toBe(false)
  })

  it("passes the toolset through for modules that support it (analytics:read-only)", () => {
    vi.stubEnv("MCP_ACTIVE_MODULES", "analytics:read-only")

    const analytics = activeApps().find((e) => e.app === "analytics")
    expect(analytics).toBeDefined()
    expect(analytics?.config).toMatchObject({ toolset: "read-only" })
  })

  it("still skips unknown modules, with or without a toolset suffix", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubEnv("MCP_ACTIVE_MODULES", "nope:read-only,camunda7:admin")

    const apps = activeApps()
    expect(apps.map((e) => e.app)).toEqual(["camunda7"])
    expect(apps[0].config).toMatchObject({ toolset: "admin" })
    // Said once per boot, among the boot warnings.
    emitBootWarnings(process.env)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown module "nope"'))
    warn.mockRestore()
  })
})

/**
 * #336 / N138: analytics reads only the server's configured engines — a
 * Prometheus is often shared across teams. The composition root hands it
 * camunda7's engine ids (analytics has no engine-SDK dependency).
 */
describe("setup.ts scopes analytics to the configured engines", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubEnv("MCP_ACTIVE_MODULES", undefined)
    vi.stubEnv("CAMUNDA_ENGINES_FILE", undefined)
    vi.stubEnv("CAMUNDA_ENGINES_JSON", undefined)
    vi.stubEnv("CAMUNDA_BASE_URL", undefined)
    vi.stubEnv("ANALYTICS_ENGINE_IDS", undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  /** The engine ids the booted analytics plugin covers. */
  function analyticsEngines(): readonly string[] {
    const plugin = getPlugins().find((p) => p.definition.name === "analytics")
    expect(plugin, "analytics module should be active").toBeDefined()
    return (plugin!.appConfig as { engineScope: { ids: readonly string[] } }).engineScope.ids
  }

  it("injects camunda7's configured engine ids", () => {
    vi.stubEnv(
      "CAMUNDA_ENGINES_JSON",
      JSON.stringify([
        { id: "prod-a", baseUrl: "http://a.example/engine-rest" },
        { id: "prod-b", baseUrl: "http://b.example/engine-rest" },
      ]),
    )
    expect(analyticsEngines()).toEqual(["prod-a", "prod-b"])
  })

  it("falls back to ANALYTICS_ENGINE_IDS when camunda7 is inactive", () => {
    vi.stubEnv("MCP_ACTIVE_MODULES", "analytics")
    vi.stubEnv("ANALYTICS_ENGINE_IDS", "prod-a,prod-c")
    expect(analyticsEngines()).toEqual(["prod-a", "prod-c"])
  })

  it("boots analytics fail-closed — no engine readable — when neither names one", () => {
    vi.stubEnv("MCP_ACTIVE_MODULES", "analytics")
    expect(analyticsEngines()).toEqual([])
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Analytics covers no engine"))
  })
})

describe("setup.ts engine credential enforcement (fail fast, no silent anonymous requests)", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.stubEnv("MCP_ACTIVE_MODULES", undefined)
    vi.stubEnv("CAMUNDA_ENGINES_FILE", undefined)
    vi.stubEnv("CAMUNDA_ENGINES_JSON", undefined)
    vi.stubEnv("CAMUNDA_BASE_URL", undefined)
    vi.stubEnv("CAMUNDA_AUTH_TYPE", undefined)
    vi.stubEnv("CAMUNDA_USERNAME", undefined)
    vi.stubEnv("CAMUNDA_PASSWORD", undefined)
    vi.stubEnv("CAMUNDA_TOKEN", undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it("fails the boot when basic auth lacks a password", () => {
    vi.stubEnv("CAMUNDA_AUTH_TYPE", "basic")
    vi.stubEnv("CAMUNDA_USERNAME", "demo")

    expect(() => getPlugins()).toThrow(/CAMUNDA_USERNAME and CAMUNDA_PASSWORD/)
  })

  it("fails the boot when bearer auth lacks a token", () => {
    vi.stubEnv("CAMUNDA_AUTH_TYPE", "bearer")

    expect(() => getPlugins()).toThrow(/CAMUNDA_TOKEN/)
  })

  it("boots with complete basic credentials", () => {
    vi.stubEnv("CAMUNDA_AUTH_TYPE", "basic")
    vi.stubEnv("CAMUNDA_USERNAME", "demo")
    vi.stubEnv("CAMUNDA_PASSWORD", "demo")

    expect(getPlugins().length).toBeGreaterThan(0)
  })

  it("does not require global credentials when every engine carries per-engine auth", () => {
    vi.stubEnv("CAMUNDA_AUTH_TYPE", "basic")
    vi.stubEnv(
      "CAMUNDA_ENGINES_JSON",
      JSON.stringify([
        {
          id: "a",
          baseUrl: "http://a.example/engine-rest",
          auth: { type: "bearer", token: "tok-a" },
        },
      ]),
    )

    expect(getPlugins().length).toBeGreaterThan(0)
  })

  it("accepts per-engine auth entries in CAMUNDA_ENGINES_JSON", () => {
    vi.stubEnv(
      "CAMUNDA_ENGINES_JSON",
      JSON.stringify([
        { id: "a", baseUrl: "http://a.example/engine-rest" },
        {
          id: "b",
          baseUrl: "http://b.example/engine-rest",
          auth: { type: "bearer", token: "tok-b" },
        },
      ]),
    )

    expect(getPlugins().length).toBeGreaterThan(0)
  })

  it("fails the boot on an incomplete per-engine auth entry", () => {
    vi.stubEnv(
      "CAMUNDA_ENGINES_JSON",
      JSON.stringify([
        { id: "a", baseUrl: "http://a.example/engine-rest", auth: { type: "basic" } },
      ]),
    )

    expect(() => getPlugins()).toThrow(/requires username and password/)
  })
})

describe("setup.ts module boot hints", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const ENGINE_ENV = { CAMUNDA_BASE_URL: "http://localhost:8410/engine-rest" }
  const PROM_ENV = { PROMETHEUS_URL: "http://localhost:8460" }

  it("warns per unconfigured module: Prometheus URL and the engine fallback", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const warnings = emitBootWarnings({})
    expect(warnings).toHaveLength(2)
    expect(warnings.some((w) => w.includes("PROMETHEUS_URL"))).toBe(true)
    expect(warnings.some((w) => w.includes("CAMUNDA_BASE_URL"))).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("PROMETHEUS_URL"))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("CAMUNDA_BASE_URL"))
  })

  it("stays silent when both modules are configured", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(emitBootWarnings({ ...PROM_ENV, ...ENGINE_ENV })).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it("scopes each hint to its module's active state", () => {
    // An inactive module must not leak its warning into the boot log.
    expect(emitBootWarnings({ MCP_ACTIVE_MODULES: "camunda7", ...ENGINE_ENV })).toEqual([])
    expect(emitBootWarnings({ MCP_ACTIVE_MODULES: "analytics", ...PROM_ENV })).toEqual([])
  })

  it("lets an empty PROMETHEUS_URL fall through to the schema default", () => {
    vi.stubEnv("MCP_ACTIVE_MODULES", undefined)
    vi.stubEnv("PROMETHEUS_URL", "")

    const analytics = getAppConfig().activeApps.find((e) => e.app === "analytics")
    expect((analytics?.config as { url?: string }).url).toBeUndefined()
  })
})

describe("warnUnknownEnvVars", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("flags unknown CAMUNDA_*/MCP_* variables (typos)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const unknown = warnUnknownEnvVars({
      CAMUNDA_ENGINE_JSON: "[]",
      MCP_DASHBOARDS_DIR: "./x",
      CAMUNDA_BASE_URL: "http://ok.example",
    })

    expect(unknown.sort()).toEqual(["CAMUNDA_ENGINE_JSON", "MCP_DASHBOARDS_DIR"])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("ignores known variables, foreign prefixes, and unrelated names", () => {
    const unknown = warnUnknownEnvVars({
      MCP_OAUTH: "{}",
      MCP_USE_ANONYMIZED_TELEMETRY: "false",
      MCP_INSPECTOR_FRAME_ANCESTORS: "*",
      MCP_USE_LOG_LEVEL: "debug",
      PATH: "/usr/bin",
      PROMETHEUS_URL: "http://localhost:8460",
    })

    expect(unknown).toEqual([])
  })

  it("accepts extra secret names (named in a config the root reads) via the extra allowlist", () => {
    expect(
      warnUnknownEnvVars({ MCP_IDP_CLIENT_SECRET: "secret" }, ["MCP_IDP_CLIENT_SECRET"]),
    ).toEqual([])
  })
})

/**
 * The server reads no PULSE_* variable. PulseAudio owns PULSE_* (PULSE_SERVER,
 * PULSE_COOKIE, ...) and PULSE_CLI_* belongs to the CLI. The typo warner watches
 * the prefix of every known variable, so ONE server name under PULSE_ would make
 * every server in a shared environment (a devcontainer, a Compose file, a shell
 * that also runs the CLI) warn about both. Name a server setting in its own
 * family instead (CAMUNDA_*, PROMETHEUS_*, ANALYTICS_*, MCP_*, DATABASE_URL).
 */
describe("the server reads no PULSE_* variable", () => {
  /** A PULSE_ name on its own (IMPULSE_RATE, MY_PULSE_X and the word Pulse are no hit). */
  const PULSE_NAME = /\bPULSE_[A-Z0-9]/
  /** The server's sources: this app and every package; another app (a CLI) owns its own names. */
  const SERVER_SCOPE = /^(?:apps\/mcp-server-camunda7\/src\/|packages\/)/

  /** Every line of `text` that names a PULSE_ variable, as `file:line: text`. */
  const pulseLines = (file: string, text: string): string[] =>
    text
      .split("\n")
      .flatMap((line, index) =>
        PULSE_NAME.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
      )

  /** The PULSE_ lines of a server source; a file outside the server's scope gives none. */
  const pulseRefs = (file: string, text: string): string[] =>
    SERVER_SCOPE.test(file.split(path.sep).join("/")) ? pulseLines(file, text) : []

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("declares none: no known variable of the app, the shared edge, OAuth or a module", () => {
    expect([...composition.knownEnvVars].filter((name) => name.startsWith("PULSE_"))).toEqual([])
  })

  it("never flags PulseAudio's or the CLI's variables in a shared environment", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const unknown = warnUnknownEnvVars({
      PULSE_SERVER: "unix:/run/user/1000/pulse/native",
      PULSE_COOKIE: "/tmp/pulse-cookie",
      PULSE_CLI_URL: "http://localhost:8080/engine-rest",
      PULSE_CLI_TOKEN: "token",
    })

    expect(unknown).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ["packages/x/src/a.ts", "const url = process.env.PULSE_URL", 1],
    ["packages/connectors/c/c-domain/src/a.ts", 'read("PULSE_SERVER")', 1],
    ["apps/mcp-server-camunda7/src/a.ts", 'const name = "PULSE_CLI_TOKEN"', 1],
    ["apps/mcp-server-camunda7/src/a.ts", "// set PULSE_2 in the shell", 1],
    ["packages/x/src/a.ts", "const rate = env.IMPULSE_RATE", 0],
    ["packages/x/src/a.ts", "const MY_PULSE_X = 1", 0],
    ["packages/x/src/a.ts", 'const id = "pulse_server"', 0],
    ["packages/x/src/a.ts", 'const label = "Pulse"', 0],
    ["packages/x/src/a.ts", 'const prefix = "PULSE_"', 0],
    // Another app is out of the server's scope: the CLI and the extension name their own.
    ["apps/cli/src/env.ts", "const url = process.env.PULSE_CLI_URL", 0],
    ["apps/vscode/src/env.ts", "const url = process.env.PULSE_CLI_URL", 0],
  ] as const)("%s: %s gives %i hit(s)", (file, line, count) => {
    expect(pulseRefs(file, `const a = 1\n${line}\n`)).toHaveLength(count)
  })

  it("names the file and the line of a hit", () => {
    expect(pulseRefs("packages/x/src/a.ts", "const a = 1\n  env.PULSE_URL \n")).toEqual([
      "packages/x/src/a.ts:2: env.PULSE_URL",
    ])
  })

  it("no server source names one (this app and every package)", () => {
    expect(scanSources(pulseRefs)).toEqual([])
  })

  it.each([".env.example", "templates/composed-server/.env.example"])("%s names none", (file) => {
    expect(pulseLines(file, fs.readFileSync(path.join(REPO_ROOT, file), "utf8"))).toEqual([])
  })
})
