import type { GlossaryLanguage } from "./catalog.js"

/** A word for a count: what it counts, in every Pulse UI that shows it. */
export interface CountTerm extends Readonly<Record<GlossaryLanguage, string>> {
  readonly counts: string
  /**
   * The same word spelled out, for a label that stands alone, away from the thing it counts on
   * (a KPI tile): one count, the word in two lengths, never a second count.
   */
  readonly long?: Readonly<Record<GlossaryLanguage, string>>
}

/**
 * The count terms (owner decision E2, 2026-11-08, amended by D2, 2026-11-12 and 2026-11-19): one
 * word per count, and a word never names two counts. "Incidents" are the open ROOT incidents of the
 * thing shown on every surface (the chat's cockpit and its views the web app embeds since
 * 2026-11-21): a copy Camunda 7 holds at a call activity of a called instance's incident is never a
 * number (nor a row of a process, an activity or a cause), a diagram shows it apart as an incident
 * in called instances, and an instance counts the root incidents of its tree. "With incident" keeps the reading of 2026-11-14:
 * an open incident the runtime holds now, so a caller that waits on a failed called instance
 * counts. A feature more than one surface shows shows the same numbers on every surface, from one
 * builder over one read. The surfaces may still read a different version scope (one version or
 * every one), so a count's version scope is always named in the header above it: "all versions"
 * for every version of a process, the version itself ("v3") for one.
 */
export const COUNT_TERMS = {
  incidents: {
    counts: "the open root incidents of the thing shown",
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
