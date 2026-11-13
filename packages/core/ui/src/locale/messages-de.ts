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
    loading: "Wird geladen…",
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
    refreshFailedFinalHint: "Du siehst das vorherige Ergebnis.",
    loadMoreFailed: "Weitere Einträge konnten nicht geladen werden",
    loadMoreFailedHint: "Die Einträge oben sind aktuell. Versuch es gleich noch mal.",
    loadMoreFailedFinalHint: "Die Einträge oben sind aktuell.",
  },
  filterBar: { searchPlaceholder: "Filtern…", searchLabel: "Filtern", chipsLabel: "Filter" },
  searchField: { label: "Suchen", placeholder: "Suchen…", clear: "Suche leeren" },
  dataTable: {
    selectAll: "Alle gezeigten Zeilen auswählen",
    resizeColumn: ({ column }) => `Breite der Spalte ${column} ändern`,
    columnWidth: ({ width }) => `${width} Pixel`,
    columnMenu: ({ column }) => `Breite der Spalte ${column}`,
    fitColumn: "An Inhalt anpassen",
    widerColumn: "Breiter",
    narrowerColumn: "Schmaler",
    resetColumns: "Alle Breiten zurücksetzen",
  },
  viewBar: { back: "Zurück", readOnly: "Nur Lesezugriff", writable: "Schreibzugriff" },
  copyableId: {
    copy: ({ label }) => `${label} kopieren`,
    copied: ({ label }) => `${label} kopiert`,
    done: "Kopiert",
  },
  conditionChip: {
    edit: ({ label }) => `Filter ${label} bearbeiten`,
    remove: ({ label }) => `Filter ${label} entfernen`,
  },
  stateLabel: {
    running: "Läuft",
    suspended: "Ausgesetzt",
    completed: "Abgeschlossen",
    cancelled: "Abgebrochen",
    ended: "Beendet",
    incident: "Incident",
  },
  pills: { live: "Live" },
}
