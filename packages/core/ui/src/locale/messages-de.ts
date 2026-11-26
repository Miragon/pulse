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
    noValue: "kein Wert",
  },
  listFooter: {
    showing: ({ shown, total, noun }) => `Zeigt ${shown} von ${total} ${noun}`.trimEnd(),
    defaultNoun: (total) => (total === "1" ? "Zeile" : "Zeilen"),
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
    rowOpens: "Enter öffnet die Zeile.",
    rowOpensCopies: "Enter öffnet die Zeile, Strg oder Cmd+C kopiert ihre ID.",
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
  count: { atLeast: ({ count }) => `mindestens ${count}`, unknown: "Anzahl unbekannt" },
  freshness: { asOf: ({ time }) => `Stand ${time}` },
  sectionState: {
    kept: "Du siehst das vorherige Ergebnis.",
    sameFailure: "Nicht gelesen, aus demselben Grund wie oben.",
    sameFailureKept:
      "Nicht aktualisiert, aus demselben Grund wie oben. Du siehst das vorherige Ergebnis.",
  },
  pageError: {
    needsReauth: ({ connector }) => `Deine Anmeldung bei ${connector} ist abgelaufen`,
    needsReauthHint: ({ connector, place }) =>
      `Verbinde ${connector}${at(place)} neu und versuch es dann noch mal.`,
    notConnected: ({ connector }) => `Diese Seite ist nicht mit ${connector} verbunden`,
    notConnectedHint: ({ connector, place }) =>
      `Richte ${connector}${at(place)} ein und versuch es dann noch mal.`,
    selectionRequired: ({ connector }) =>
      `Diese Seite wartet darauf, dass du ihre Verbindung zu ${connector} wählst`,
    selectionRequiredHint: ({ connector }) =>
      `Wähl die Verbindung zu ${connector}, die die Seite nutzen soll, wenn du gefragt wirst, und versuch es dann noch mal.`,
    notDeclared: ({ connector }) =>
      `Diese Seite ist nicht dafür eingerichtet, ${connector} zu nutzen`,
    notDeclaredHint: ({ connector }) =>
      `Nur die Person, die die Seite veröffentlicht hat, kann ihre Verbindung zu ${connector} einrichten. Frag sie.`,
    notAllowed: () => "Diese Seite darf das Tool nicht aufrufen, das sie braucht",
    notAllowedHint: () =>
      "Eine Einstellung der Seite oder eine Richtlinie deiner Organisation sperrt den Aufruf. Frag die Person, die die Seite veröffentlicht hat.",
    approvalRequired: () => "Dieser Lesezugriff wartet auf deine Freigabe",
    approvalRequiredHint: ({ connector }) =>
      `Erlaube der Seite, ${connector} zu nutzen, wenn du gefragt wirst, und versuch es dann noch mal.`,
    unavailable: ({ connector }) => `${connector} antwortet nicht`,
    unavailableHint: ({ connector }) =>
      `Versuch es gleich noch mal. Klappt es weiter nicht, frag die Person, die ${connector} betreibt.`,
    toolError: ({ connector }) => `${connector} konnte diesen Lesezugriff nicht ausführen`,
    toolErrorHint: ({ connector }) =>
      `Versuch es noch mal. Klappt es wieder nicht, frag die Person, die ${connector} betreibt.`,
  },
  bpmn: {
    zoomIn: "Vergrößern",
    zoomOut: "Verkleinern",
    fit: "An Ansicht anpassen",
    drawFailed: "Das Diagramm ließ sich nicht zeichnen",
    drawFailedHint: "Öffne das Modell in deinem Modeler, um es zu prüfen.",
    countRunning: ({ element, count }) =>
      `${element}: ${String(count) === "1" ? `${count} Instanz läuft` : `${count} Instanzen laufen`}`,
    countIncidents: ({ element, count }) =>
      `${element}: ${count} ${String(count) === "1" ? "Incident" : "Incidents"}`,
    countIncidentsInCalledInstances: ({ element, count }) =>
      `${element}: ${count} ${String(count) === "1" ? "Incident" : "Incidents"} in aufgerufenen Instanzen`,
    legendLabel: "Legende",
    legendRunning: "wartet hier",
    legendIncidents: "Incident hier",
    legendIncidentsInCalledInstances: "Incident in einer aufgerufenen Instanz",
  },
}

/** A place after a name, as the page passes it („in claude.ai …“); nothing without one. */
function at(place: string | undefined): string {
  return place ? ` ${place}` : ""
}
