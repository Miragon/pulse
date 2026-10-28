import { afterEach, describe, expect, it, vi } from "vitest"
import {
  composeModules,
  frameworkWritesAllowed,
  type ComposableModule,
  type ResolvedBoot,
} from "./composition.js"
import { createToolsetVocabulary } from "./toolsets.js"

interface TestShared {
  tag: string
}

const moduleOf = (
  name: string,
  overrides: Partial<ComposableModule<TestShared>> = {},
): ComposableModule<TestShared> => ({
  name,
  configFromEnv: (env) => ({ url: env[`${name.toUpperCase()}_URL`] ?? "default" }),
  knownEnvVars: [`${name.toUpperCase()}_URL`],
  toolsets: createToolsetVocabulary(
    name,
    ["read-only", "operations", "admin"] as const,
    "read-only",
    {
      authenticatedDefault: "operations",
    },
  ),
  createPlugin: (config, shared) =>
    ({ definition: { name }, config, shared }) as unknown as ReturnType<
      ComposableModule<TestShared>["createPlugin"]
    >,
  ...overrides,
})

const compose = (modules: ComposableModule<TestShared>[] = [moduleOf("alpha"), moduleOf("beta")]) =>
  composeModules<TestShared>({
    label: "test-root",
    modules,
    appEnvVars: ["MCP_ACTIVE_MODULES", "MCP_PROFILE_DIR"],
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe("activeModules / appEntries", () => {
  it("activates every module when MCP_ACTIVE_MODULES is unset or 'all'", () => {
    expect(compose().activeModules({})).toEqual([{ name: "alpha" }, { name: "beta" }])
    expect(compose().activeModules({ MCP_ACTIVE_MODULES: "all" })).toEqual([
      { name: "alpha" },
      { name: "beta" },
    ])
  })

  it("parses the comma list with optional module:toolset suffixes", () => {
    expect(compose().activeModules({ MCP_ACTIVE_MODULES: "beta:read-only, alpha" })).toEqual([
      { name: "beta", toolset: "read-only" },
      { name: "alpha" },
    ])
  })

  it("keeps an EMPTY suffix distinct from no suffix, trims both halves, keeps extra colons", () => {
    expect(
      compose().activeModules({ MCP_ACTIVE_MODULES: "alpha:, beta : admin:read-only" }),
    ).toEqual([
      { name: "alpha", toolset: "" },
      { name: "beta", toolset: "admin:read-only" },
    ])
  })

  it("skips unknown modules, warning ONCE per boot in the boot warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const env = { MCP_ACTIVE_MODULES: "nope:read-only,alpha" }
    const composition = compose()
    expect(composition.activeModules(env)).toEqual([{ name: "alpha" }])
    composition.resolveBoot(env)
    expect(warn).not.toHaveBeenCalled()
    composition.emitBootWarnings(env)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[test-root] Unknown module "nope"'))
  })

  it("refuses a module named twice, whichever suffixes it carries", () => {
    for (const value of ["alpha,alpha:read-only", "alpha:admin, beta, alpha"]) {
      expect(() => compose().resolveBoot({ MCP_ACTIVE_MODULES: value })).toThrow(
        /MCP_ACTIVE_MODULES names "alpha" more than once/,
      )
    }
  })

  it("threads the EFFECTIVE toolset into every module config; config comes from configFromEnv(env)", () => {
    const entries = compose().appEntries({
      MCP_ACTIVE_MODULES: "alpha:admin,beta",
      ALPHA_URL: "http://a",
    })
    expect(entries).toEqual([
      { app: "alpha", config: { url: "http://a", toolset: "admin" } },
      { app: "beta", config: { url: "default", toolset: "read-only" } },
    ])
  })

  it("strips the toolset suffix (warning) for modules without toolsets", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const modules = [moduleOf("alpha", { toolsets: undefined })]
    const entries = compose(modules).appEntries({ MCP_ACTIVE_MODULES: "alpha:read-only" })
    expect(entries[0].config).not.toHaveProperty("toolset")
    expect(warn).toHaveBeenCalledWith(
      '[test-root] Module "alpha" has no toolsets — ignoring ":read-only"',
    )
  })

  it("passes no raw suffix through: the removed supportsToolsets flag makes no module toolset-bearing", () => {
    // A definition still carrying the old pass-through flag is a module WITHOUT toolsets.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const stale = { ...moduleOf("alpha", { toolsets: undefined }), supportsToolsets: true }
    const composition = compose([stale])
    const boot = composition.resolveBoot(
      { MCP_ACTIVE_MODULES: "alpha:admin" },
      { authenticated: true },
    )
    expect(boot.entries[0].config).not.toHaveProperty("toolset")
    expect(boot.toolsets).toEqual([{ module: "alpha", source: "none", durableWrites: true }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[test-root] Module "alpha" has no toolsets — ignoring ":admin"',
    )
    vi.spyOn(console, "info").mockImplementation(() => {})
    expect(composition.logEffectiveToolsets(boot)).toBe(
      "[test-root] Toolsets — alpha (no toolsets)",
    )
  })

  it("appConfig wraps the entries in the mcp-use shape", () => {
    expect(compose().appConfig({ MCP_ACTIVE_MODULES: "alpha" })).toEqual({
      activeApps: [{ app: "alpha", config: { url: "default", toolset: "read-only" } }],
      pipelines: {},
    })
    expect(compose().appConfig({ MCP_ACTIVE_MODULES: "alpha" }, { authenticated: true })).toEqual({
      activeApps: [{ app: "alpha", config: { url: "default", toolset: "operations" } }],
      pipelines: {},
    })
  })
})

describe("resolveBoot — the fail-closed toolset rule", () => {
  const toolsetsOf = (boot: ResolvedBoot) =>
    Object.fromEntries(boot.toolsets.map(({ module, toolset }) => [module, toolset]))

  it.each([undefined, "", "all", "alpha,beta"])(
    "MCP_ACTIVE_MODULES=%j defaults to the floor without OAuth and to the standard toolset with it — never admin",
    (value) => {
      const env = value === undefined ? {} : { MCP_ACTIVE_MODULES: value }
      const anonymous = compose().resolveBoot(env)
      expect(anonymous.authenticated).toBe(false)
      expect(toolsetsOf(anonymous)).toEqual({ alpha: "read-only", beta: "read-only" })
      expect(anonymous.toolsets.every(({ source }) => source === "default")).toBe(true)
      expect(toolsetsOf(compose().resolveBoot(env, { authenticated: true }))).toEqual({
        alpha: "operations",
        beta: "operations",
      })
    },
  )

  it.each(["alpha:,beta:", "alpha: ,beta:  ", "alpha:bogus,beta:admin:read-only"])(
    "empty or unknown suffixes (%j) fail closed to the floor, even under OAuth",
    (value) => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
      const boot = compose().resolveBoot({ MCP_ACTIVE_MODULES: value }, { authenticated: true })
      expect(toolsetsOf(boot)).toEqual({ alpha: "read-only", beta: "read-only" })
      expect(boot.toolsets.every(({ source }) => source === "fallback")).toBe(true)
      expect(boot.entries.map(({ config }) => config.toolset)).toEqual(["read-only", "read-only"])
    },
  )

  it("an explicit suffix wins over the default in both auth modes", () => {
    for (const authenticated of [false, true]) {
      const boot = compose().resolveBoot(
        { MCP_ACTIVE_MODULES: "alpha:admin,beta:read-only" },
        { authenticated },
      )
      expect(toolsetsOf(boot)).toEqual({ alpha: "admin", beta: "read-only" })
      expect(boot.toolsets.map(({ source }) => source)).toEqual(["suffix", "suffix"])
    }
  })

  it("warns ONCE per boot for an unknown suffix", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    compose().resolveBoot({ MCP_ACTIVE_MODULES: "alpha:typo" })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[alpha] Unknown toolset "typo"'))
  })

  it("reports whether each effective toolset permits durable writes", () => {
    const boot = compose().resolveBoot({ MCP_ACTIVE_MODULES: "alpha:operations,beta" })
    expect(boot.toolsets).toEqual([
      { module: "alpha", toolset: "operations", source: "suffix", durableWrites: true },
      { module: "beta", toolset: "read-only", source: "default", durableWrites: false },
    ])
  })

  it("leaves modules without toolsets unrestricted and toolset-free", () => {
    const boot = compose([moduleOf("alpha", { toolsets: undefined })]).resolveBoot({})
    expect(boot.toolsets).toEqual([{ module: "alpha", source: "none", durableWrites: true }])
    expect(boot.entries[0].config).not.toHaveProperty("toolset")
  })
})

describe("logEffectiveToolsets", () => {
  it("logs ONE info line naming each module's toolset and why", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const modules = [
      moduleOf("alpha"),
      moduleOf("beta"),
      moduleOf("gamma", { toolsets: undefined }),
    ]
    const composition = compose(modules)
    const boot = composition.resolveBoot({ MCP_ACTIVE_MODULES: "alpha:admin,beta:typo,gamma" })
    const line = composition.logEffectiveToolsets(boot)
    expect(line).toBe(
      "[test-root] Toolsets — alpha:admin (suffix), beta:read-only (fallback), gamma (no toolsets)",
    )
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(line)
    expect(warn).toHaveBeenCalledTimes(1) // the typo, nothing from the log itself
  })

  it("names the auth mode behind a default", () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const composition = compose([moduleOf("alpha"), moduleOf("beta", { toolsets: undefined })])
    const env = { MCP_ACTIVE_MODULES: "alpha,beta" }
    expect(composition.logEffectiveToolsets(composition.resolveBoot(env))).toBe(
      "[test-root] Toolsets — alpha:read-only (default without OAuth), beta (no toolsets)",
    )
    expect(
      composition.logEffectiveToolsets(composition.resolveBoot(env, { authenticated: true })),
    ).toBe("[test-root] Toolsets — alpha:operations (default with OAuth), beta (no toolsets)")
  })

  it("says so when no module is active", () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const composition = compose()
    expect(
      composition.logEffectiveToolsets(composition.resolveBoot({ MCP_ACTIVE_MODULES: "nope" })),
    ).toBe("[test-root] Toolsets — no active modules")
  })
})

describe("instructions", () => {
  const instructed = (name: string) =>
    moduleOf(name, {
      instructions: (config, { authenticated }) =>
        `${name}: toolset ${String(config.toolset)}, url ${String(config.url)}, ` +
        `${authenticated ? "signed in" : "anonymous"}`,
    })

  it("joins the ACTIVE modules' snippets in selection order, each from its own boot config", () => {
    const composition = compose([instructed("alpha"), instructed("beta"), instructed("gamma")])
    const boot = composition.resolveBoot(
      { MCP_ACTIVE_MODULES: "beta:admin,alpha", ALPHA_URL: "http://a" },
      { authenticated: true },
    )
    expect(composition.instructions(boot)).toBe(
      "beta: toolset admin, url default, signed in\n\n" +
        "alpha: toolset operations, url http://a, signed in",
    )
  })

  it("skips modules without a snippet or with an empty one; none at all is undefined", () => {
    const composition = compose([
      instructed("alpha"),
      moduleOf("beta"),
      moduleOf("gamma", { instructions: () => "  " }),
    ])
    expect(composition.instructions(composition.resolveBoot({}))).toBe(
      "alpha: toolset read-only, url default, anonymous",
    )
    expect(
      composition.instructions(composition.resolveBoot({ MCP_ACTIVE_MODULES: "beta,gamma" })),
    ).toBeUndefined()
  })
})

describe("frameworkWritesAllowed", () => {
  const boot = (authenticated: boolean, env: NodeJS.ProcessEnv) =>
    compose([
      moduleOf("alpha"),
      moduleOf("beta"),
      moduleOf("gamma", { toolsets: undefined }),
    ]).resolveBoot(env, { authenticated })

  it("requires OAuth — without a caller identity framework records are ownerless", () => {
    expect(
      frameworkWritesAllowed(boot(false, { MCP_ACTIVE_MODULES: "alpha:admin,beta:admin" })),
    ).toBe(false)
  })

  it("allows them under OAuth when every module permits durable writes", () => {
    expect(frameworkWritesAllowed(boot(true, {}))).toBe(true)
    expect(frameworkWritesAllowed(boot(true, { MCP_ACTIVE_MODULES: "alpha:admin,gamma" }))).toBe(
      true,
    )
  })

  it("refuses them when ANY module sits on its read-only floor — the most restrictive wins", () => {
    expect(
      frameworkWritesAllowed(boot(true, { MCP_ACTIVE_MODULES: "alpha:admin,beta:read-only" })),
    ).toBe(false)
  })
})

describe("pluginsFor", () => {
  it("instantiates each entry's plugin with the shared resources", () => {
    const composition = compose()
    const entries = composition.appEntries({ MCP_ACTIVE_MODULES: "beta" })
    const plugins = composition.pluginsFor(entries, { tag: "shared-1" })
    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toMatchObject({ shared: { tag: "shared-1" } })
  })
})

describe("warnUnknownEnvVars", () => {
  it("watches every prefix derived from known vars, not just a hardcoded family", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const unknown = compose().warnUnknownEnvVars({
      ALPHA_URLX: "typo", // derived prefix ALPHA_
      MCP_PROFILE_DIRX: "typo", // derived prefix MCP_
      PATH: "/usr/bin", // unwatched prefix
      BETA_URL: "http://ok", // known
    })
    expect(unknown.sort()).toEqual(["ALPHA_URLX", "MCP_PROFILE_DIRX"])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("exempts foreign prefixes and honors the extra allowlist", () => {
    expect(
      compose().warnUnknownEnvVars({ MCP_USE_ANONYMIZED_TELEMETRY: "false", MCP_SECRET: "x" }, [
        "MCP_SECRET",
      ]),
    ).toEqual([])
  })

  it("exempts `<KNOWN_VAR>_*` extensions (docker-secrets style), but not near-misses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const unknown = compose().warnUnknownEnvVars({
      BETA_URL_FILE: "/run/secrets/beta", // extends the known BETA_URL — another process's var
      BETA_URLX: "typo", // near-miss, not an extension — still warns
    })
    expect(unknown).toEqual(["BETA_URLX"])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("appends the optional hint to the warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    composeModules<TestShared>({
      label: "test-root",
      modules: [moduleOf("alpha")],
      envVarHint: "see docs/operations.md",
    }).warnUnknownEnvVars({ ALPHA_TYPO: "x" })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("(see docs/operations.md)"))
  })
})

describe("emitBootWarnings", () => {
  it("collects and logs hints from ACTIVE modules only", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const modules = [
      moduleOf("alpha", { bootWarnings: () => ["alpha hint"] }),
      moduleOf("beta", { bootWarnings: () => ["beta hint"] }),
    ]
    const warnings = compose(modules).emitBootWarnings({ MCP_ACTIVE_MODULES: "beta" })
    expect(warnings).toEqual(["beta hint"])
    expect(warn).toHaveBeenCalledWith("[test-root] beta hint")
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("alpha hint"))
  })
})
