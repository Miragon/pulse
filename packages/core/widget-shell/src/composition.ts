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
  /** Names this module carried before: the boot refuses each while it is set, naming its replacement. */
  retired?: {
    /** Former names in `MCP_ACTIVE_MODULES`. */
    names?: readonly string[]
    /** Former environment variables, each with the variable that replaces it. */
    envVars?: Readonly<Record<string, string>>
    /**
     * Former variables a shell may still export for another tool (a credential the CLI's docs
     * name, say): the boot warns, naming the replacement, instead of refusing.
     */
    warnedEnvVars?: Readonly<Record<string, string>>
  }
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
  /**
   * Every module's retired variable with the one that replaces it (`retiredEnvVars`), refused or
   * warned about; never read.
   */
  retiredEnvVars: ReadonlyMap<string, string>
  /**
   * Throws ONCE on every retired variable that is set (blank included) and every retired module
   * name in `MCP_ACTIVE_MODULES`, naming each replacement, so one failed boot names every rename.
   * The boot calls it first, before any other setting is checked; `resolveBoot` refuses the same,
   * `activeModules` the module names.
   */
  refuseRetired: (env?: NodeJS.ProcessEnv) => void
  /** Unset/`all` = every module; an unknown name fails the boot, listing the known modules. */
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
  /**
   * The boot's own former variables, each with the one that replaces it: refused like a module's
   * `retired.envVars`, in the same message.
   */
  appRetiredEnvVars?: Readonly<Record<string, string>>
  /** Prefixes owned by other tools in a shared environment, exempt from the typo warner. */
  foreignEnvPrefixes?: readonly string[]
  envVarHint?: string
}): ModuleComposition<TShared> {
  const {
    label,
    modules,
    appEnvVars = [],
    appRetiredEnvVars = {},
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
  const { retiredNames, refusedEnvVars, warnedEnvVars } = retiredTables(
    modules,
    knownEnvVars,
    appRetiredEnvVars,
  )
  const retiredEnvVars = new Map([...refusedEnvVars, ...warnedEnvVars])

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

  /** Every retired setting of `env` in one error: the variables, then the module names. */
  const refuseRetired = (env: NodeJS.ProcessEnv): void => {
    const sentences = [
      ...retiredEnvVarSentences(env, refusedEnvVars),
      ...retiredNameSentences(listedModules(env) ?? [], retiredNames),
    ]
    if (sentences.length > 0) throw new Error(`[${label}] ${sentences.join(" ")}`)
  }

  /**
   * A former name names its replacement; an unknown one (a typo, a module this root does not
   * compose) lists the known modules. Either would otherwise boot a healthy server WITHOUT the
   * module it asks for, with no tools at all when no listed name is known.
   */
  const activeModules = (env: NodeJS.ProcessEnv = process.env): ActiveModuleRef[] => {
    const refs = listedModules(env)
    if (refs === undefined) return modules.map(({ name }) => ({ name }))
    const sentences = retiredNameSentences(refs, retiredNames)
    if (sentences.length > 0) throw new Error(`[${label}] ${sentences.join(" ")}`)
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
    refuseRetired(env)
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
    retiredEnvVars,
    refuseRetired(env = process.env) {
      refuseRetired(env)
    },
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
          `[${label}] Unknown environment variable "${name}": the server does not read it; ` +
            `check for a typo${envVarHint ? ` (${envVarHint})` : ""}.`,
        )
      }
      return unknown
    },
    emitBootWarnings(env = process.env) {
      // Separate from `configFromEnv`, which stays side-effect free.
      const warnings = [
        ...warnedEnvVarSentences(env, warnedEnvVars),
        ...activeModules(env).flatMap(({ name }) => registry[name].bootWarnings?.(env) ?? []),
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

/**
 * Every module's former names, each with its current one, built once per composition. A table
 * that contradicts itself (a former name that is a current module or a variable a module reads)
 * fails at compose time instead of refusing a working setting.
 */
function retiredTables<TShared>(
  modules: readonly ComposableModule<TShared>[],
  knownEnvVars: ReadonlySet<string>,
  appRetiredEnvVars: Readonly<Record<string, string>>,
): {
  retiredNames: ReadonlyMap<string, string>
  refusedEnvVars: ReadonlyMap<string, string>
  warnedEnvVars: ReadonlyMap<string, string>
} {
  // In any case: the boot matches a former name in any case.
  const current = new Set(modules.map(({ name }) => name.toLowerCase()))
  const retiredNames = new Map<string, string>()
  const refusedEnvVars = appRetiredTable(appRetiredEnvVars, knownEnvVars)
  const warnedEnvVars = new Map<string, string>()
  for (const module of modules) {
    for (const former of module.retired?.names ?? []) {
      if (current.has(former.toLowerCase())) {
        throw new Error(
          `Module "${module.name}" retires the name "${former}", which a composed module still carries.`,
        )
      }
      retiredNames.set(former, module.name)
    }
    const retiring: [ReadonlyMap<string, string>, Map<string, string>][] = [
      [new Map(Object.entries(module.retired?.envVars ?? {})), refusedEnvVars],
      [new Map(Object.entries(module.retired?.warnedEnvVars ?? {})), warnedEnvVars],
    ]
    for (const [table, into] of retiring) {
      for (const [former, replacement] of table) {
        if (knownEnvVars.has(former)) {
          throw new Error(
            `Module "${module.name}" retires the variable ${former}, which a composed module still reads.`,
          )
        }
        if (refusedEnvVars.has(former) || warnedEnvVars.has(former)) {
          throw new Error(`The variable ${former} is retired twice (module "${module.name}").`)
        }
        into.set(former, replacement)
      }
    }
  }
  return { retiredNames, refusedEnvVars, warnedEnvVars }
}

/** The root's own former variables, seeding the refused table the modules' join. */
function appRetiredTable(
  appRetiredEnvVars: Readonly<Record<string, string>>,
  knownEnvVars: ReadonlySet<string>,
): Map<string, string> {
  const table = new Map(Object.entries(appRetiredEnvVars))
  for (const former of table.keys()) {
    if (knownEnvVars.has(former)) {
      throw new Error(
        `The server retires the variable ${former}, which it or a module still reads.`,
      )
    }
  }
  return table
}

/** One warning per warned retired variable that is present: the server reads its replacement. */
function warnedEnvVarSentences(
  env: NodeJS.ProcessEnv,
  warnedEnvVars: ReadonlyMap<string, string>,
): string[] {
  return [...warnedEnvVars.keys()]
    .filter((name) => env[name] !== undefined)
    .sort()
    .map(
      (name) =>
        `${name} is no longer read; the server reads ${warnedEnvVars.get(name)}. Rename it if it was meant for the server.`,
    )
}

/**
 * One sentence for every retired variable that is present, blank included: its value would be
 * ignored.
 */
function retiredEnvVarSentences(
  env: NodeJS.ProcessEnv,
  retiredEnvVars: ReadonlyMap<string, string>,
): string[] {
  const present = [...retiredEnvVars.keys()].filter((name) => env[name] !== undefined).sort()
  if (present.length === 0) return []
  const one = present.length === 1
  const renames = present.map((name) => `${name} becomes ${retiredEnvVars.get(name)}`).join(", ")
  return [
    `${present.join(", ")} ${one ? "is" : "are"} no longer read, so the server does not start ` +
      `with ${one ? "a setting" : "settings"} it would ignore. ` +
      `Rename ${one ? "it, the value stays" : "them, the values stay"}: ${renames}.`,
  ]
}

/**
 * One sentence per retired entry, its suffix carried over to the current name. A former name
 * matches in any case: it means nothing else, and as an unknown name it would only warn.
 */
function retiredNameSentences(
  refs: readonly ActiveModuleRef[],
  retiredNames: ReadonlyMap<string, string>,
): string[] {
  return refs.flatMap(({ name, toolset }) => {
    const current = [...retiredNames].find(
      ([former]) => former.toLowerCase() === name.toLowerCase(),
    )?.[1]
    if (current === undefined) return []
    const suffix = toolset === undefined ? "" : `:${toolset}`
    return [
      `MCP_ACTIVE_MODULES names "${name}", the former name of the ${current} module, so the server ` +
        `does not start without the module it asks for. ` +
        `Write ${current} instead: ${name}${suffix} becomes ${current}${suffix}.`,
    ]
  })
}
