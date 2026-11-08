import type { ModuleServer } from "./module-server.js"
import type { ToolsetSource, ToolsetVocabulary } from "./toolsets.js"

/** What a module hands the boot. */
export interface ModulePlugin {
  /** The module name; the boot's duplicate name guards name it. */
  name: string
  /**
   * Registers all of the module's tools, prompts and resources with the official SDK's
   * `registerTool`, `registerPrompt` and `registerResource` (or `registerAppTool` and
   * `registerAppResource` from `@modelcontextprotocol/ext-apps/server`), once: the boot records
   * them and serves the bundle views they bind. Handlers read the caller through the ambient
   * request info (`callerCacheKey`, passthrough auth), which the boot installs.
   */
  register(server: ModuleServer): void
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
  /**
   * `config` is the very object the root's `shared` saw as this entry's `ModuleEntry.config`, so
   * a module may key per-boot state on it (the engine module's one engine registry).
   */
  createPlugin(config: Record<string, unknown>, shared: TShared): ModulePlugin
}

interface ActiveModuleRef {
  name: string
  /** Kept even when EMPTY (`engine:` → `""`), so an empty suffix fails closed like an unknown one. */
  toolset?: string
}

interface EffectiveToolset {
  module: string
  toolset?: string
  source: ToolsetSource | "none"
}

export interface ResolvedBoot {
  authenticated: boolean
  entries: ModuleEntry[]
  toolsets: EffectiveToolset[]
}

/**
 * The active modules nothing narrows on this boot: they declare no toolsets, so they register
 * every tool, and without OAuth no caller signs in. Each write among their tools is open to
 * anyone who reaches the port.
 */
export function unguardedModules(boot: ResolvedBoot): ReadonlySet<string> {
  if (boot.authenticated) return new Set()
  return new Set(
    boot.toolsets.filter(({ source }) => source === "none").map(({ module }) => module),
  )
}

interface ResolveBootOptions {
  /**
   * Only the boot knows whether it INSTALLED OAuth; reading `MCP_OAUTH_*` here would count a
   * boot without the bearer gate as authenticated and fail open. Omitted = `false`.
   */
  authenticated?: boolean
}

/** What the boot (`createComposedServer`) composes the modules into; no root sees it. */
export interface ModuleComposition<TShared> {
  /** The one source of the variables a boot reads (`composedEnvVars`). */
  knownEnvVars: ReadonlySet<string>
  /** Unset/`all` = every module; an unknown name fails the boot, listing the known modules. */
  activeModules: (env?: NodeJS.ProcessEnv) => ActiveModuleRef[]
  /** Call once per boot; derive the plugins and the boot log from the result. */
  resolveBoot: (env?: NodeJS.ProcessEnv, options?: ResolveBootOptions) => ResolvedBoot
  pluginsFor: (entries: ModuleEntry[], shared: TShared) => ModulePlugin[]
  warnUnknownEnvVars: (env?: NodeJS.ProcessEnv) => string[]
  emitBootWarnings: (env?: NodeJS.ProcessEnv) => string[]
  logEffectiveToolsets: (boot: ResolvedBoot) => string
  instructions: (boot: ResolvedBoot) => string | undefined
}

export function composeModules<TShared>(options: {
  label: string
  modules: readonly ComposableModule<TShared>[]
  appEnvVars?: readonly string[]
  /** Prefixes owned by other tools in a shared environment, exempt from the typo warner. */
  foreignEnvPrefixes?: readonly string[]
  envVarHint?: string
}): ModuleComposition<TShared> {
  const {
    label,
    modules,
    appEnvVars = [],
    // The MCP Inspector `pnpm dev` starts: its own namespace, the ports that move it and its
    // client's OAuth callback.
    foreignEnvPrefixes = [
      "MCP_INSPECTOR_",
      "MCP_SANDBOX_PORT",
      "MCP_APP_ORIGIN_PORT",
      "MCP_OAUTH_CALLBACK_URL",
    ],
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
   * `engine:` keeps its empty suffix, which warns and falls back to the read-only floor instead
   * of counting as no suffix (the standard toolset under OAuth). A repeated name is refused: two
   * plugins would collide and the winning suffix is a guess.
   */
  /** The entries of `MCP_ACTIVE_MODULES` as written; undefined when unset or `all`. */
  const listedModules = (env: NodeJS.ProcessEnv): ActiveModuleRef[] | undefined => {
    const envValue = env.MCP_ACTIVE_MODULES?.trim()
    if (!envValue || envValue === "all") return undefined
    return envValue
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry): ActiveModuleRef => {
        // Everything after the FIRST colon is the suffix, so extra colons fail closed too.
        const colon = entry.indexOf(":")
        if (colon === -1) return { name: entry }
        return { name: entry.slice(0, colon).trim(), toolset: entry.slice(colon + 1).trim() }
      })
  }

  /**
   * An unknown name (a typo, a module this root does not compose) lists the known modules. It
   * would otherwise boot a healthy server WITHOUT the module it asks for, with no tools at all
   * when no listed name is known.
   */
  const activeModules = (env: NodeJS.ProcessEnv = process.env): ActiveModuleRef[] => {
    const refs = listedModules(env)
    if (refs === undefined) return modules.map(({ name }) => ({ name }))
    const repeated = [...new Set(refs.map(({ name }) => name))].filter(
      (name) => refs.filter((ref) => ref.name === name).length > 1,
    )
    if (repeated.length > 0) {
      throw new Error(
        `[${label}] MCP_ACTIVE_MODULES names ${repeated.map((name) => `"${name}"`).join(", ")} more than once. List each module once, with at most one :toolset.`,
      )
    }
    const unknown = refs.filter(({ name }) => !registry[name]).map(({ name }) => `"${name}"`)
    if (unknown.length > 0) {
      const one = unknown.length === 1
      throw new Error(
        `[${label}] MCP_ACTIVE_MODULES names ${one ? "an unknown module" : "the unknown modules"} ${unknown.join(", ")}, ` +
          `so the server does not start without the ${one ? "module" : "modules"} it asks for. ` +
          `Known modules: ${modules.map(({ name }) => name).join(", ")}.`,
      )
    }
    return refs
  }

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
      console.warn(`[${label}] Module "${module.name}" has no toolsets: ignoring ":${suffix}"`)
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
    warnUnknownEnvVars(env = process.env) {
      // `<KNOWN_VAR>_*` (ENGINE_PASSWORD_FILE, …) addresses OTHER processes, never a typo.
      const extendsKnownVar = (name: string) =>
        [...knownEnvVars].some((knownName) => name.startsWith(`${knownName}_`))
      const unknown = Object.keys(env).filter(
        (name) =>
          watchedPrefixes.some((prefix) => name.startsWith(prefix)) &&
          !knownEnvVars.has(name) &&
          !extendsKnownVar(name) &&
          !foreignEnvPrefixes.some((prefix) => name.startsWith(prefix)),
      )
      for (const name of unknown) {
        console.warn(
          `[${label}] Unknown environment variable "${name}": the server does not read it; ` +
            `check for a typo${envVarHint ? ` (${envVarHint})` : ""}.`,
        )
      }
      return unknown
    },
    emitBootWarnings(env = process.env) {
      // Separate from `configFromEnv`, which stays side-effect free.
      const warnings = activeModules(env).flatMap(
        ({ name }) => registry[name].bootWarnings?.(env) ?? [],
      )
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
      const surface = boot.toolsets.map(describe).join(", ") || "no active modules"
      // Only a list leaves one off, and without this a module that list misses is silently absent.
      const active = new Set(boot.toolsets.map(({ module }) => module))
      const leftOff = modules.map(({ name }) => name).filter((name) => !active.has(name))
      const off =
        leftOff.length > 0 ? `; left off by MCP_ACTIVE_MODULES: ${leftOff.join(", ")}` : ""
      const line = `[${label}] Toolsets: ${surface}${off}`
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
