/** The shared fail-closed toolset rule: no suffix → floor (unauthenticated) or `authenticatedDefault` (OAuth); empty/unknown suffix → warn + floor, since a suffix always means to restrict. Nothing resolves to "everything". Vocabularies stay module-owned. */
export interface ToolsetVocabulary<T extends string> {
  module: string
  names: readonly T[]
  /** The read-only floor: empty/unknown suffixes, unauthenticated boots and direct callers without a toolset land here. */
  fallback: T
  /** The no-suffix default under OAuth — the module's standard non-admin toolset. */
  authenticatedDefault: T
  isKnown(value: string): value is T
  /** A missing toolset only arrives from a direct `createPlugin` caller, which gets the floor, never everything. */
  resolve(toolset: string | undefined): T
  /** `undefined` = no suffix, `""` = present but empty. */
  effective(suffix: string | undefined, options: { authenticated: boolean }): EffectiveSelection<T>
  /** Whether the toolset permits durable writes — every toolset above the read-only floor. */
  allowsDurableWrites(toolset: T): boolean
}

/** Where an effective toolset came from — the reason the boot log names. */
export type ToolsetSource = "suffix" | "default" | "fallback"

export interface EffectiveSelection<T extends string> {
  toolset: T
  source: ToolsetSource
}

export function createToolsetVocabulary<T extends string>(
  moduleName: string,
  names: readonly T[],
  /** A suffix is always an attempt to restrict, so a typo must never grant more than the strictest set. */
  fallback: NoInfer<T>,
  options: {
    /** Omitted = the fallback (a module whose only toolset is its floor). */
    authenticatedDefault?: NoInfer<T>
  } = {},
): ToolsetVocabulary<T> {
  const { authenticatedDefault = fallback } = options
  const isKnown = (value: string): value is T => (names as readonly string[]).includes(value)
  const degrade = (reason: string): T => {
    console.warn(
      `[${moduleName}] ${reason} — falling back to "${fallback}". Known toolsets: ${names.join(", ")}`,
    )
    return fallback
  }
  return {
    module: moduleName,
    names,
    fallback,
    authenticatedDefault,
    isKnown,
    resolve(toolset) {
      if (toolset === undefined) return fallback
      return isKnown(toolset) ? toolset : degrade(`Unknown toolset "${toolset}"`)
    },
    effective(suffix, { authenticated }) {
      if (suffix === undefined) {
        return { toolset: authenticated ? authenticatedDefault : fallback, source: "default" }
      }
      const name = suffix.trim()
      if (isKnown(name)) return { toolset: name, source: "suffix" }
      const reason = name === "" ? "Empty toolset suffix" : `Unknown toolset "${name}"`
      return { toolset: degrade(reason), source: "fallback" }
    },
    allowsDurableWrites(toolset) {
      return toolset !== fallback
    },
  }
}
