import type { CatalogLanguage } from "./catalog-text.js"

/** A word for a count: what it counts, in every Pulse UI that shows it. */
export interface CountTerm extends Readonly<Record<CatalogLanguage, string>> {
  readonly counts: string
  /**
   * The same word spelled out, for a label that stands alone, away from the thing it counts on
   * (a KPI tile): one count, the word in two lengths, never a second count.
   */
  readonly long?: Readonly<Record<CatalogLanguage, string>>
}

/**
 * The count terms (owner decision E2, 2026-11-08, amended by D2, 2026-11-12). The MCP widgets and
 * the VS Code webview may read a count differently (all incidents or the root ones, one version or
 * every one), so the words, not the numbers, are aligned: one word per count, and a word never
 * names two counts. Which number stands behind a word stays each tool's rule until its view moves
 * onto shared numbers; a feature more than one surface shows (boards first) shows the same numbers
 * on every surface, from one builder over one read. A count's version scope is always named in the
 * header above it: "all versions" for every version of a process, the version itself ("v3") for
 * one.
 */
export const COUNT_TERMS = {
  incidents: {
    counts: "the open incidents of the thing shown",
    de: "Incidents",
    en: "Incidents",
    long: { de: "Offene Incidents", en: "Open incidents" },
  },
  withIncident: {
    counts: "the instances that have an open incident",
    de: "Mit Incident",
    en: "With incident",
  },
  allVersions: {
    counts: "the version scope of a count over every version of a process",
    de: "alle Versionen",
    en: "all versions",
  },
} as const satisfies Readonly<Record<string, CountTerm>>
