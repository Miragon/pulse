import type { UiMessages } from "./message-types.js"

/**
 * German catalog. du-Ansprache, aktive Sätze, normale Groß- und
 * Kleinschreibung, „…“ als Auslassung, kein Gedankenstrich als Verbinder.
 * Fehlertexte sagen, was passiert ist und was du tun kannst. Guarded by
 * `ui-messages.test.ts`.
 */
export const de: UiMessages = {
  common: {
    close: "Schließen",
    retry: "Erneut versuchen",
    details: "Details",
    dismiss: "Hinweis schließen",
    notifications: "Hinweise",
    loadFailed: "Der Inhalt konnte nicht geladen werden",
    loadFailedHint: "Versuch es noch mal. Klappt es wieder nicht, frag im Chat nach.",
  },
  listFooter: {
    showing: ({ shown, total, noun }) => `Zeigt ${shown} von ${total} ${noun}`.trimEnd(),
    defaultNoun: "Zeilen",
    loadMore: "Mehr laden",
    loadingMore: "Wird geladen…",
    updating: "Wird aktualisiert…",
    noResults: "Keine Einträge",
    refreshFailed: "Die Liste konnte nicht aktualisiert werden",
    refreshFailedHint: "Du siehst das vorherige Ergebnis. Versuch es gleich noch mal.",
    loadMoreFailed: "Weitere Einträge konnten nicht geladen werden",
    loadMoreFailedHint: "Die Einträge oben sind aktuell. Versuch es gleich noch mal.",
  },
  filterBar: { searchPlaceholder: "Filtern…", searchLabel: "Filtern", chipsLabel: "Filter" },
  pills: { live: "Live" },
}
