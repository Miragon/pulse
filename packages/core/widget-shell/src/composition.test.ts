import { afterEach, describe, expect, it, vi } from "vitest"
import { composeModules, type ResolvedBoot } from "./composition.js"
import { compose, moduleOf, type TestShared } from "./composition.test-support.js"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("activeModules / resolveBoot entries", () => {
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

  // While unknown names were skipped, a typo booted a healthy server without the module it names
  // (no tools at all when no listed name was known), and the health checks passed it.
  it("refuses an unknown module, listing the known ones, before any config or warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const configFromEnv = vi.fn(() => ({}))
    const composition = compose([moduleOf("alpha", { configFromEnv }), moduleOf("beta")])
    const one =
      '[test-root] MCP_ACTIVE_MODULES names an unknown module "nope", so the server does not start without the module it asks for. Known modules: alpha, beta.'
    const env = { MCP_ACTIVE_MODULES: "nope:read-only,alpha" }
    expect(() => composition.activeModules(env)).toThrow(one)
    expect(() => composition.resolveBoot(env)).toThrow(one)
    expect(() => composition.emitBootWarnings(env)).toThrow(one)
    expect(() => composition.resolveBoot({ MCP_ACTIVE_MODULES: "Alpha,betas:admin" })).toThrow(
      '[test-root] MCP_ACTIVE_MODULES names the unknown modules "Alpha", "betas", so the server does not start without the modules it asks for. Known modules: alpha, beta.',
    )
    expect(configFromEnv).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it("refuses a module named twice, whichever suffixes it carries", () => {
    for (const value of ["alpha,alpha:read-only", "alpha:admin, beta, alpha"]) {
      expect(() => compose().resolveBoot({ MCP_ACTIVE_MODULES: value })).toThrow(
        /MCP_ACTIVE_MODULES names "alpha" more than once/,
      )
    }
  })

  it("threads the EFFECTIVE toolset into every module config; config comes from configFromEnv(env)", () => {
    const { entries } = compose().resolveBoot({
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
    const { entries } = compose(modules).resolveBoot({ MCP_ACTIVE_MODULES: "alpha:read-only" })
    expect(entries[0].config).not.toHaveProperty("toolset")
    expect(warn).toHaveBeenCalledWith(
      '[test-root] Module "alpha" has no toolsets: ignoring ":read-only"',
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
    expect(boot.toolsets).toEqual([{ module: "alpha", source: "none" }])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[test-root] Module "alpha" has no toolsets: ignoring ":admin"',
    )
    vi.spyOn(console, "info").mockImplementation(() => {})
    expect(composition.logEffectiveToolsets(boot)).toBe("[test-root] Toolsets: alpha (no toolsets)")
  })
})

describe("resolveBoot: the fail-closed toolset rule", () => {
  const toolsetsOf = (boot: ResolvedBoot) =>
    Object.fromEntries(boot.toolsets.map(({ module, toolset }) => [module, toolset]))

  it.each([undefined, "", "all", "alpha,beta"])(
    "MCP_ACTIVE_MODULES=%j defaults to the floor without OAuth and to the standard toolset with it, never admin",
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

  it("reports each module's effective toolset and where it came from", () => {
    const boot = compose().resolveBoot({ MCP_ACTIVE_MODULES: "alpha:operations,beta" })
    expect(boot.toolsets).toEqual([
      { module: "alpha", toolset: "operations", source: "suffix" },
      { module: "beta", toolset: "read-only", source: "default" },
    ])
  })

  it("leaves modules without toolsets toolset-free", () => {
    const boot = compose([moduleOf("alpha", { toolsets: undefined })]).resolveBoot({})
    expect(boot.toolsets).toEqual([{ module: "alpha", source: "none" }])
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
      "[test-root] Toolsets: alpha:admin (suffix), beta:read-only (fallback), gamma (no toolsets)",
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
      "[test-root] Toolsets: alpha:read-only (default without OAuth), beta (no toolsets)",
    )
    expect(
      composition.logEffectiveToolsets(composition.resolveBoot(env, { authenticated: true })),
    ).toBe("[test-root] Toolsets: alpha:operations (default with OAuth), beta (no toolsets)")
  })

  it("says so when no module is active", () => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const composition = compose([])
    expect(composition.logEffectiveToolsets(composition.resolveBoot({}))).toBe(
      "[test-root] Toolsets: no active modules",
    )
  })

  // A module copied into the root's list but not into a copied .env would otherwise stay absent
  // with no word in the log.
  it("names the modules of the root's list that MCP_ACTIVE_MODULES leaves off, on the one line", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    const composition = compose([moduleOf("alpha"), moduleOf("beta"), moduleOf("gamma")])
    const logFor = (value: string) =>
      composition.logEffectiveToolsets(composition.resolveBoot({ MCP_ACTIVE_MODULES: value }))
    expect(logFor("beta:admin")).toBe(
      "[test-root] Toolsets: beta:admin (suffix); left off by MCP_ACTIVE_MODULES: alpha, gamma",
    )
    expect(info).toHaveBeenCalledTimes(1)
    expect(logFor(",")).toBe(
      "[test-root] Toolsets: no active modules; left off by MCP_ACTIVE_MODULES: alpha, beta, gamma",
    )
  })

  it.each([
    ["unset", {}],
    ["all", { MCP_ACTIVE_MODULES: "all" }],
    ["naming every module", { MCP_ACTIVE_MODULES: "beta,alpha" }],
  ])("names none when the list is %s", (_case, env) => {
    vi.spyOn(console, "info").mockImplementation(() => {})
    const composition = compose([moduleOf("alpha"), moduleOf("beta")])
    expect(composition.logEffectiveToolsets(composition.resolveBoot(env))).not.toContain("left off")
  })
})

describe("instructions", () => {
  const instructed = (name: string) =>
    moduleOf(name, {
      instructions: (config) =>
        `${name}: toolset ${String(config.toolset)}, url ${String(config.url)}`,
    })

  it("joins the ACTIVE modules' snippets in selection order, each from its own boot config", () => {
    const composition = compose([instructed("alpha"), instructed("beta"), instructed("gamma")])
    const boot = composition.resolveBoot(
      { MCP_ACTIVE_MODULES: "beta:admin,alpha", ALPHA_URL: "http://a" },
      { authenticated: true },
    )
    expect(composition.instructions(boot)).toBe(
      "beta: toolset admin, url default\n\n" + "alpha: toolset operations, url http://a",
    )
  })

  it("skips modules without a snippet or with an empty one; none at all is undefined", () => {
    const composition = compose([
      instructed("alpha"),
      moduleOf("beta"),
      moduleOf("gamma", { instructions: () => "  " }),
    ])
    expect(composition.instructions(composition.resolveBoot({}))).toBe(
      "alpha: toolset read-only, url default",
    )
    expect(
      composition.instructions(composition.resolveBoot({ MCP_ACTIVE_MODULES: "beta,gamma" })),
    ).toBeUndefined()
  })
})

describe("pluginsFor", () => {
  it("instantiates each entry's plugin with its config and the shared resources", () => {
    const composition = compose()
    const { entries } = composition.resolveBoot({ MCP_ACTIVE_MODULES: "beta" })
    const plugins = composition.pluginsFor(entries, { tag: "shared-1" })
    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toMatchObject({
      name: "beta",
      config: { url: "default", toolset: "read-only" },
      shared: { tag: "shared-1" },
    })
  })

  it("skips an entry no module of this composition owns", () => {
    const plugins = compose().pluginsFor([{ app: "stranger", config: {} }], { tag: "shared-1" })
    expect(plugins).toEqual([])
  })
})

describe("warnUnknownEnvVars", () => {
  it("watches every prefix derived from known vars, not just a hardcoded family", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const unknown = compose().warnUnknownEnvVars({
      ALPHA_URLX: "typo", // derived prefix ALPHA_
      MCP_URLX: "typo", // derived prefix MCP_
      PATH: "/usr/bin", // unwatched prefix
      BETA_URL: "http://ok", // known
    })
    expect(unknown.sort()).toEqual(["ALPHA_URLX", "MCP_URLX"])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("exempts foreign prefixes", () => {
    expect(compose().warnUnknownEnvVars({ MCP_INSPECTOR_SECRET_STORE: "memory" })).toEqual([])
  })

  // `pnpm dev` starts the MCP Inspector next to the server; moving its ports sets these for both.
  it("exempts the inspector's own port and callback variables, not a near-miss of them", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(
      compose().warnUnknownEnvVars({
        MCP_SANDBOX_PORT: "6285",
        MCP_APP_ORIGIN_PORT: "6288",
        MCP_OAUTH_CALLBACK_URL: "http://localhost:6274/oauth/callback",
        MCP_SANDBOX_PROT: "6285",
      }),
    ).toEqual(["MCP_SANDBOX_PROT"])
    expect(warn).toHaveBeenCalledOnce()
  })

  it("exempts `<KNOWN_VAR>_*` extensions (docker-secrets style), but not near-misses", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const unknown = compose().warnUnknownEnvVars({
      BETA_URL_FILE: "/run/secrets/beta", // extends the known BETA_URL: another process's var
      BETA_URLX: "typo", // near-miss, not an extension: still warns
    })
    expect(unknown).toEqual(["BETA_URLX"])
    expect(warn).toHaveBeenCalledTimes(1)
  })

  // The engine module's profiles name ENGINE_SECRET_* variables: those the operator sets are read.
  it("takes the variables an active module's own settings name as known, never a near-miss", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const referencedEnvVars = vi.fn((env: NodeJS.ProcessEnv) =>
      env.ALPHA_URL === "named" ? ["ALPHA_SECRET_A"] : [],
    )
    const composition = compose([moduleOf("alpha", { referencedEnvVars }), moduleOf("beta")])
    const env = { ALPHA_URL: "named", ALPHA_SECRET_A: "s", ALPHA_SECRET_B: "s" }
    expect(composition.warnUnknownEnvVars(env)).toEqual(["ALPHA_SECRET_B"])
    expect(referencedEnvVars).toHaveBeenCalledWith(env)
    expect(warn).toHaveBeenCalledOnce()
    // A module the list leaves off names none.
    expect(composition.warnUnknownEnvVars({ ...env, MCP_ACTIVE_MODULES: "beta" })).toEqual([
      "ALPHA_SECRET_A",
      "ALPHA_SECRET_B",
    ])
  })

  it("names nothing referenced when a module's hook throws or the module list is refused", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const throwing = moduleOf("alpha", {
      referencedEnvVars: () => {
        throw new Error("unreadable")
      },
    })
    const env = { ALPHA_SECRET_A: "s" }
    expect(compose([throwing]).warnUnknownEnvVars(env)).toEqual(["ALPHA_SECRET_A"])
    const named = moduleOf("alpha", { referencedEnvVars: () => ["ALPHA_SECRET_A"] })
    expect(compose([named]).warnUnknownEnvVars({ ...env, MCP_ACTIVE_MODULES: "nope" })).toEqual([
      "ALPHA_SECRET_A",
    ])
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
