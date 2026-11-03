import type { HandOffAction } from "./hand-off-button.js"
import { resolveLanguage, type Locale } from "./host-context.js"

/** The kit ships no catalog, so its components' few defaults come from here; props override. */
export interface KitLabels {
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
  rowsShown: (p: { shown: string; total: string }) => string
  showAll: string
  showMore: string
  /** The view frame (`ViewFrame`): its waiting, cancel, error and toolbar words. */
  slowHint: string
  cancelled: string
  viewErrorTitle: string
  viewMissing: string
  viewCrashed: string
  enterFullscreen: string
  exitFullscreen: string
  reloadedAt: (time: string) => string
}

const LABELS: Record<Locale, KitLabels> = {
  en: {
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
    rowsShown: ({ shown, total }) => `${shown} of ${total} shown`,
    showAll: "Show all",
    showMore: "Show more",
    slowHint: "This is taking longer than usual. If nothing happens, ask in the chat again.",
    cancelled: "Cancelled. Ask in the chat to open this view again.",
    viewErrorTitle: "This view couldn't be loaded",
    viewMissing: "This app can't show this view. Ask in the chat to open it again.",
    viewCrashed: "This element couldn't be displayed.",
    enterFullscreen: "Fullscreen",
    exitFullscreen: "Exit fullscreen",
    reloadedAt: (time) => `Reloaded at ${time}`,
  },
  de: {
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
    rowsShown: ({ shown, total }) => `${shown} von ${total} angezeigt`,
    showAll: "Alle anzeigen",
    showMore: "Mehr anzeigen",
    slowHint: "Das dauert länger als üblich. Wenn nichts passiert, frag im Chat noch mal nach.",
    cancelled: "Abgebrochen. Frag im Chat noch mal nach dieser Ansicht.",
    viewErrorTitle: "Die Ansicht konnte nicht geladen werden",
    viewMissing: "Diese App kann die Ansicht nicht anzeigen. Frag im Chat noch mal nach ihr.",
    viewCrashed: "Dieses Element konnte nicht angezeigt werden.",
    enterFullscreen: "Vollbild",
    exitFullscreen: "Vollbild verlassen",
    reloadedAt: (time) => `Neu geladen um ${time} Uhr`,
  },
}

export function kitLabels(locale: string | undefined): KitLabels {
  return LABELS[resolveLanguage(locale)]
}

export const KIT_LABELS: Readonly<Record<Locale, KitLabels>> = LABELS
