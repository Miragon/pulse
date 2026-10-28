import type { AppConfig, AppConfigEntry, AppPlugin } from "@miragon/mcp-toolkit-core"
import type { MCPServer } from "mcp-use"
import type { ToolsetSource, ToolsetVocabulary } from "./toolsets.js"

/**
 * Composition-root machinery. Each root declares its own shared-resources type, module list and
 * cross-module wiring; modules conform STRUCTURALLY and never import this type.
 */
export interface ComposableModule<TShared> {
  /** Key in `MCP_ACTIVE_MODULES` and the `activeApps` entry name. */
  name: string
  /** Pure env → raw-config mapping; no `process.env`, no I/O side effects. */
  configFromEnv(env: NodeJS.ProcessEnv): Record<string, unknown>
  knownEnvVars: readonly string[]
  /** Opts into the `module:toolset` suffix; absent = a suffix is ignored with a warning. */
  toolsets?: ToolsetVocabulary<string>
  bootWarnings?(env: NodeJS.ProcessEnv): string[]
  /** Model-facing usage notes joined into the server `instructions`, stated ONCE instead of per tool. */
  instructions?(config: Record<string, unknown>, context: InstructionsContext): string | undefined
  createPlugin(config: Record<string, unknown>, shared: TShared): AppPlugin<MCPServer>
}

export interface InstructionsContext {
  authenticated: boolean
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
  /** A module without toolsets declares no restriction (`true`). */
  durableWrites: boolean
}

export interface ResolvedBoot {
  authenticated: boolean
  entries: AppConfigEntry[]
  toolsets: EffectiveToolset[]
}

export interface ResolveBootOptions {
  /**
   * Only the root knows whether it INSTALLED OAuth; a server without OAuth wiring would read a stray
   * `MCP_OAUTH` as authenticated and fail open. Omitted = `false`.
   */
  authenticated?: boolean
}

/** `this`-free closures, so roots may destructure or re-export them. */
export interface ModuleComposition<TShared> {
  knownEnvVars: ReadonlySet<string>
  /** Unset/`all` = every module; unknown names warn and are skipped. */
  activeModules: (env?: NodeJS.ProcessEnv) => ActiveModuleRef[]
  /** Call once per boot; derive plugins, `AppConfig` and the boot log from the result. */
  resolveBoot: (env?: NodeJS.ProcessEnv, options?: ResolveBootOptions) => ResolvedBoot
  appEntries: (env?: NodeJS.ProcessEnv, options?: ResolveBootOptions) => AppConfigEntry[]
  appConfig: (env?: NodeJS.ProcessEnv, options?: ResolveBootOptions) => AppConfig
  pluginsFor: (entries: AppConfigEntry[], shared: TShared) => AppPlugin<MCPServer>[]
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
   * Not the toolkit's `parseActiveModules`: it reads `camunda7:` as no qualifier instead of failing
   * closed. A repeated name is refused: two plugins would collide and the winning suffix is a guess.
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
      return {
        module: module.name,
        toolset,
        source,
        durableWrites: vocabulary.allowsDurableWrites(toolset),
      }
    }
    if (suffix !== undefined) {
      console.warn(`[${label}] Module "${module.name}" has no toolsets — ignoring ":${suffix}"`)
    }
    return { module: module.name, source: "none", durableWrites: true }
  }

  const resolveBoot = (
    env: NodeJS.ProcessEnv = process.env,
    { authenticated = false }: ResolveBootOptions = {},
  ): ResolvedBoot => {
    const toolsets: EffectiveToolset[] = []
    const entries = activeModules(env).map(({ name, toolset: suffix }): AppConfigEntry => {
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

  const appEntries = (env?: NodeJS.ProcessEnv, options?: ResolveBootOptions): AppConfigEntry[] =>
    resolveBoot(env, options).entries

  return {
    knownEnvVars,
    activeModules,
    resolveBoot,
    appEntries,
    appConfig(env, options) {
      return { activeApps: appEntries(env, options), pipelines: {} }
    },
    pluginsFor(entries, shared) {
      return entries
        .filter((entry) => registry[entry.app])
        .map((entry) => registry[entry.app].createPlugin(entry.config, shared))
    },
    warnUnknownEnvVars(env = process.env, extraKnown = []) {
      const known = new Set([...knownEnvVars, ...extraKnown])
      // `<KNOWN_VAR>_*` (DATABASE_URL_FILE, …) addresses OTHER processes, never a typo.
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
      const context: InstructionsContext = { authenticated: boot.authenticated }
      const snippets = boot.entries
        .map((entry) => registry[entry.app]?.instructions?.(entry.config, context)?.trim())
        .filter((snippet): snippet is string => Boolean(snippet))
      return snippets.length > 0 ? snippets.join("\n\n") : undefined
    },
  }
}

/**
 * Framework durable writes (dashboard builder, `shell_save_settings`) need a caller identity and no
 * module on its read-only floor: the most restrictive module wins.
 */
export function frameworkWritesAllowed(boot: ResolvedBoot): boolean {
  return boot.authenticated && boot.toolsets.every(({ durableWrites }) => durableWrites)
}
