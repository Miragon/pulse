import type { Locale } from "../profile-constants.js"
import type { HandOffAction } from "./hand-off-button.js"
import { supportedLanguage } from "./host-context.js"

/** The kit ships no catalog, so its components' few defaults come from here; props override. */
export interface KitLabels {
  loading: string
  loadingView: string
  zoomIn: string
  zoomOut: string
  fitViewport: string
  retry: string
  /** `useDetailView`'s stale notice. */
  refreshFailed: string
  refreshStale: string
  askAiDefault: string
  openInVendor: (vendor: string | undefined) => string
  opensInNewTab: (label: string) => string
  handOff: Readonly<Record<HandOffAction, string>>
  copyId: (id: string) => string
  idCopied: string
  copyFailed: string
  copyFailedHint: string
  fullId: string
  working: string
  dataTable: string
  yes: string
  no: string
  noFiguresYet: string
  noRowsYet: string
  noDataHint: string
  heatmapValues: string
  rowsShown: (p: { shown: string; total: string }) => string
  showAll: string
  showMore: string
  heatmapMetric: string
  heatmapElement: string
  heatmapValue: string
  heatmapRange: (p: { min: string; max: string }) => string
}

const LABELS: Record<Locale, KitLabels> = {
  en: {
    loading: "Loading…",
    loadingView: "Loading view…",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    fitViewport: "Fit to viewport",
    retry: "Try again",
    refreshFailed: "Couldn't refresh this view",
    refreshStale: "You're seeing the last loaded state.",
    askAiDefault: "Analyze in chat",
    openInVendor: (vendor) => (vendor ? `Open in ${vendor}` : "Open in engine cockpit"),
    opensInNewTab: (label) => `${label} (opens in a new tab)`,
    handOff: {
      assess: "Assess in chat",
      findCause: "Find cause in chat",
      explainError: "Explain error in chat",
      planFix: "Plan a fix in chat",
      draftTicket: "Draft ticket in chat",
      explainTimeline: "Explain timeline in chat",
      explainDuration: "Explain duration in chat",
      checkVariables: "Check variables in chat",
      explainDiagram: "Explain state in chat",
      checkHealth: "Check health in chat",
      analyzeFailures: "Analyze failures in chat",
      analyzePerformance: "Analyze performance in chat",
      explainBottleneck: "Explain bottleneck in chat",
      prioritize: "Prioritize in chat",
      compareEngines: "Compare engines in chat",
    },
    copyId: (id) => `Copy ${id}`,
    idCopied: "ID copied",
    copyFailed: "Couldn't copy the ID",
    copyFailedHint: "The full ID is now selected. Copy it yourself.",
    fullId: "Full ID",
    working: "Working…",
    dataTable: "Data table",
    yes: "Yes",
    no: "No",
    noFiguresYet: "No figures yet",
    noRowsYet: "No rows yet",
    noDataHint: "Values appear here once the view has data.",
    heatmapValues: "Values per element",
    heatmapMetric: "Metric",
    heatmapElement: "Element",
    heatmapValue: "Value",
    heatmapRange: ({ min, max }) => `${min} to ${max}`,
    rowsShown: ({ shown, total }) => `${shown} of ${total} shown`,
    showAll: "Show all",
    showMore: "Show more",
  },
  de: {
    loading: "Wird geladen…",
    loadingView: "Ansicht wird geladen…",
    zoomIn: "Vergrößern",
    zoomOut: "Verkleinern",
    fitViewport: "An Ansicht anpassen",
    retry: "Erneut versuchen",
    refreshFailed: "Die Ansicht konnte nicht aktualisiert werden",
    refreshStale: "Du siehst den zuletzt geladenen Stand.",
    askAiDefault: "Im Chat analysieren",
    openInVendor: (vendor) => (vendor ? `In ${vendor} öffnen` : "Im Engine-Cockpit öffnen"),
    opensInNewTab: (label) => `${label}, öffnet in neuem Tab`,
    handOff: {
      assess: "Im Chat bewerten",
      findCause: "Ursache im Chat klären",
      explainError: "Fehler im Chat erklären",
      planFix: "Behebung im Chat planen",
      draftTicket: "Ticket im Chat entwerfen",
      explainTimeline: "Verlauf im Chat erklären",
      explainDuration: "Dauer im Chat erklären",
      checkVariables: "Variablen im Chat prüfen",
      explainDiagram: "Zustand im Chat erklären",
      checkHealth: "Zustand im Chat prüfen",
      analyzeFailures: "Fehler im Chat analysieren",
      analyzePerformance: "Performance im Chat analysieren",
      explainBottleneck: "Engpass im Chat erklären",
      prioritize: "Im Chat priorisieren",
      compareEngines: "Engines im Chat vergleichen",
    },
    copyId: (id) => `${id} kopieren`,
    idCopied: "ID kopiert",
    copyFailed: "Die ID ließ sich nicht kopieren",
    copyFailedHint: "Die ganze ID ist jetzt markiert. Kopier sie selbst.",
    fullId: "Ganze ID",
    working: "Wird ausgeführt…",
    dataTable: "Datentabelle",
    yes: "Ja",
    no: "Nein",
    noFiguresYet: "Noch keine Kennzahlen",
    noRowsYet: "Noch keine Zeilen",
    noDataHint: "Die Werte erscheinen hier, sobald die Ansicht Daten hat.",
    heatmapValues: "Werte je Element",
    heatmapMetric: "Kennzahl",
    heatmapElement: "Element",
    heatmapValue: "Wert",
    heatmapRange: ({ min, max }) => `${min} bis ${max}`,
    rowsShown: ({ shown, total }) => `${shown} von ${total} angezeigt`,
    showAll: "Alle anzeigen",
    showMore: "Mehr anzeigen",
  },
}

export function kitLabels(locale: string | undefined): KitLabels {
  return LABELS[supportedLanguage(locale) ?? "en"]
}

export const KIT_LABELS: Readonly<Record<Locale, KitLabels>> = LABELS
