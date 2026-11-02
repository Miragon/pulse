import type { MCPServer } from "mcp-use"
import type { ToolsetSource, ToolsetVocabulary } from "./toolsets.js"

/** What a module hands the boot. */
export interface ModulePlugin {
  /** The module name; the boot's duplicate tool-name guard names it. */
  name: string
  /**
   * Registers all of the module's tools, prompts and resources on the server the boot owns.
   * The boot installs the ambient request info (`callerCacheKey`, passthrough auth) on that
   * server for every module.
   */
  register(server: MCPServer): void
}

/** One active module as the boot resolved it; `config` carries the effective `toolset`. */
export interface ModuleEntry {
  app: string
  config: Record<string, unknown>
}

/**
 * Composition-root machinery. Each root declares its own shared-resources type, module list and
 * cross-module wiring; modules conform STRUCTURALLY and never import this type.
 */
export interface ComposableModule<TShared> {
  /** Key in `MCP_ACTIVE_MODULES` and the `app` of its `ModuleEntry`. */
  name: string
  /** Pure env → raw-config mapping; no `process.env`, no I/O side effects. */
  configFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown>
  knownEnvVars: readonly string[]
  /** Opts into the `module:toolset` suffix; absent = a suffix is ignored with a warning. */
  toolsets?: ToolsetVocabulary<string>
  bootWarnings?(env: NodeJS.ProcessEnv): string[]
  /** Model-facing usage notes joined into the server `instructions`, stated ONCE instead of per tool. */
  instructions?(config: Record<string, unknown>): string | undefined
  createPlugin(config: Record<string, unknown>, shared: TShared): ModulePlugin
}

export interface ActiveModuleRef {
  name: string
  /** Kept even when EMPTY (`camunda7:` → `""`), so an empty suffix fails closed like an unknown one. */
  toolset?: string
}

export interface EffectiveToolset {
  module: string
  toolset?: string
  source: ToolsetSource | "none"
}

export interface ResolvedBoot {
  authenticated: boolean
  entries: ModuleEntry[]
  toolsets: EffectiveToolset[]
}

export interface ResolveBootOptions {
  /**
   * Only the boot knows whether it INSTALLED OAuth; reading `MCP_USE_OAUTH_*` here would count a
   * boot without the bearer gate as authenticated and fail open. Omitted = `false`.
   */
  authenticated?: boolean
}

/** What the boot (`createComposedServer`) composes the modules into; no root sees it. */
export interface ModuleComposition<TShared> {
  /** The one source of the variables a boot reads (`composedEnvVars`). */
  knownEnvVars: ReadonlySet<string>
  /** Unset/`all` = every module; unknown names warn and are skipped. */
  activeModules: (env?: NodeJS.ProcessEnv) => ActiveModuleRef[]
  /** Call once per boot; derive the plugins and the boot log from the result. */
  resolveBoot: (env?: NodeJS.ProcessEnv, options?: ResolveBootOptions) => ResolvedBoot
  pluginsFor: (entries: ModuleEntry[], shared: TShared) => ModulePlugin[]
  warnUnknownEnvVars: (env?: NodeJS.ProcessEnv, extraKnown?: Iterable<string>) => string[]
  emitBootWarnings: (env?: NodeJS.ProcessEnv) => string[]
  logEffectiveToolsets: (boot: ResolvedBoot) => string
  instructions: (boot: ResolvedBoot) => string | undefined
}

export function composeModules<TShared>(options: {
  label: string
  modules: readonly ComposableModule<TShared>[]
  appEnvVars?: readonly string[]
  /** Prefixes owned by dependencies, exempt from the typo warner. */
  foreignEnvPrefixes?: readonly string[]
  envVarHint?: string
}): ModuleComposition<TShared> {
  const {
    label,
    modules,
    appEnvVars = [],
    foreignEnvPrefixes = ["MCP_USE_", "MCP_INSPECTOR_"],
    envVarHint,
  } = options

  const registry: Record<string, ComposableModule<TShared>> = Object.fromEntries(
    modules.map((m) => [m.name, m]),
  )
  const knownEnvVars = new Set([...appEnvVars, ...modules.flatMap((m) => [...m.knownEnvVars])])

  // Prefixes derive from every known var, so custom modules get the same typo coverage.
  const watchedPrefixes = [
    ...new Set(
      [...knownEnvVars]
        .map((name) => name.slice(0, name.indexOf("_") + 1))
        .filter((prefix) => prefix.length > 1),
    ),
  ]

  /**
   * `camunda7:` keeps its empty suffix, which warns and falls back to the read-only floor instead
   * of counting as no suffix (the standard toolset under OAuth). A repeated name is refused: two
   * plugins would collide and the winning suffix is a guess.
   */
  const parseActiveModules = (
    env: NodeJS.ProcessEnv,
  ): { known: ActiveModuleRef[]; unknown: string[] } => {
    const envValue = env.MCP_ACTIVE_MODULES?.trim()
    if (!envValue || envValue === "all") {
      return { known: modules.map(({ name }) => ({ name })), unknown: [] }
    }
    const refs = envValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry): ActiveModuleRef => {
        // Everything after the FIRST colon is the suffix, so extra colons fail closed too.
        const colon = entry.indexOf(":")
        if (colon === -1) return { name: entry }
        return { name: entry.slice(0, colon).trim(), toolset: entry.slice(colon + 1).trim() }
      })
    const repeated = [...new Set(refs.map(({ name }) => name))].filter(
      (name) => refs.filter((ref) => ref.name === name).length > 1,
    )
    if (repeated.length > 0) {
      throw new Error(
        `[${label}] MCP_ACTIVE_MODULES names ${repeated.map((name) => `"${name}"`).join(", ")} more than once — list each module once, with at most one :toolset.`,
      )
    }
    return {
      known: refs.filter(({ name }) => registry[name]),
      unknown: refs.filter(({ name }) => !registry[name]).map(({ name }) => name),
    }
  }

  const activeModules = (env: NodeJS.ProcessEnv = process.env): ActiveModuleRef[] =>
    parseActiveModules(env).known

  const effectiveToolset = (
    module: ComposableModule<TShared>,
    suffix: string | undefined,
    authenticated: boolean,
  ): EffectiveToolset => {
    const vocabulary = module.toolsets
    if (vocabulary) {
      const { toolset, source } = vocabulary.effective(suffix, { authenticated })
      return { module: module.name, toolset, source }
    }
    if (suffix !== undefined) {
      console.warn(`[${label}] Module "${module.name}" has no toolsets — ignoring ":${suffix}"`)
    }
    return { module: module.name, source: "none" }
  }

  const resolveBoot = (
    env: NodeJS.ProcessEnv = process.env,
    { authenticated = false }: ResolveBootOptions = {},
  ): ResolvedBoot => {
    const toolsets: EffectiveToolset[] = []
    const entries = activeModules(env).map(({ name, toolset: suffix }): ModuleEntry => {
      const effective = effectiveToolset(registry[name], suffix, authenticated)
      toolsets.push(effective)
      const { toolset } = effective
      return {
        app: name,
        config: {
          ...registry[name].configFromEnv(env),
          ...(toolset === undefined ? {} : { toolset }),
        },
      }
    })
    return { authenticated, entries, toolsets }
  }

  return {
    knownEnvVars,
    activeModules,
    resolveBoot,
    pluginsFor(entries, shared) {
      return entries
        .filter((entry) => registry[entry.app])
        .map((entry) => registry[entry.app].createPlugin(entry.config, shared))
    },
    warnUnknownEnvVars(env = process.env, extraKnown = []) {
      const known = new Set([...knownEnvVars, ...extraKnown])
      // `<KNOWN_VAR>_*` (PROMETHEUS_PASSWORD_FILE, …) addresses OTHER processes, never a typo.
      const extendsKnownVar = (name: string) =>
        [...known].some((knownName) => name.startsWith(`${knownName}_`))
      const unknown = Object.keys(env).filter(
        (name) =>
          watchedPrefixes.some((prefix) => name.startsWith(prefix)) &&
          !known.has(name) &&
          !extendsKnownVar(name) &&
          !foreignEnvPrefixes.some((prefix) => name.startsWith(prefix)),
      )
      for (const name of unknown) {
        console.warn(
          `[${label}] Unknown environment variable "${name}" — the server does not read it; ` +
            `check for a typo${envVarHint ? ` (${envVarHint})` : ""}.`,
        )
      }
      return unknown
    },
    emitBootWarnings(env = process.env) {
      // Separate from `configFromEnv`, which stays side-effect free.
      const { known, unknown } = parseActiveModules(env)
      const warnings = [
        ...unknown.map((name) => `Unknown module "${name}" in MCP_ACTIVE_MODULES — skipping`),
        ...known.flatMap(({ name }) => registry[name].bootWarnings?.(env) ?? []),
      ]
      for (const warning of warnings) {
        console.warn(`[${label}] ${warning}`)
      }
      return warnings
    },
    logEffectiveToolsets(boot) {
      // console.info, not a warning: it states the surface on every boot.
      const describe = ({ module, toolset, source }: EffectiveToolset): string => {
        if (toolset === undefined) return `${module} (no toolsets)`
        if (source === "default") {
          return `${module}:${toolset} (default ${boot.authenticated ? "with" : "without"} OAuth)`
        }
        return `${module}:${toolset} (${source})`
      }
      const modules = boot.toolsets.map(describe).join(", ")
      const line = `[${label}] Toolsets — ${modules || "no active modules"}`
      console.info(line)
      return line
    },
    instructions(boot) {
      const snippets = boot.entries
        .map((entry) => registry[entry.app]?.instructions?.(entry.config)?.trim())
        .filter((snippet): snippet is string => Boolean(snippet))
      return snippets.length > 0 ? snippets.join("\n\n") : undefined
    },
  }
}
