// Replaced by the browser-safe glossary of @miragon/pulse-ui once Miragon/pulse#667 lands.

/**
 * The product's count words (pulse-ui's `COUNT_TERMS`, owner decision E2), copied: its `./testing`
 * entry, the one that exports them, runs in Node only. The brand test holds this copy to the
 * original, so a word changed there fails here until the copy follows.
 */
export const COUNT_TERMS = {
  incidents: {
    de: "Incidents",
    en: "Incidents",
    long: { de: "Offene Incidents", en: "Open incidents" },
  },
  withIncident: { de: "Mit Incident", en: "With incident" },
  allVersions: { de: "alle Versionen", en: "all versions" },
} as const
