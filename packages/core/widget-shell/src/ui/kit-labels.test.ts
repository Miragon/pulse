import { describe, expect, it } from "vitest"
import { kitLabels } from "./kit-labels.js"

/** Renders the function entries so the set compares as plain strings. */
function rendered(tag: string | undefined) {
  const { handOff, ...labels } = kitLabels(tag)
  expect(Object.keys(handOff).length).toBeGreaterThan(0)
  return {
    ...labels,
    openInVendor: labels.openInVendor("CIB seven"),
    openInEngine: labels.openInVendor(undefined),
    opensInNewTab: labels.opensInNewTab("In CIB seven öffnen"),
    copyId: labels.copyId("5f0ce78e…"),
    rowsShown: labels.rowsShown({ shown: "8", total: "23" }),
    reloadedAt: labels.reloadedAt("14:32"),
  }
}

describe("kitLabels: the kit's own strings follow the active locale", () => {
  it("speaks German for any German tag", () => {
    for (const tag of ["de", "de-AT", "DE-ch"]) {
      expect(rendered(tag)).toEqual({
        loadingView: "Ansicht wird geladen…",
        zoomIn: "Vergrößern",
        zoomOut: "Verkleinern",
        fitViewport: "An Ansicht anpassen",
        retry: "Erneut versuchen",
        refreshFailed: "Die Ansicht konnte nicht aktualisiert werden",
        refreshStale: "Du siehst den zuletzt geladenen Stand.",
        askAiDefault: "Im Chat analysieren",
        openInVendor: "In CIB seven öffnen",
        openInEngine: "Im Engine-Cockpit öffnen",
        opensInNewTab: "In CIB seven öffnen, öffnet in neuem Tab",
        copyId: "5f0ce78e… kopieren",
        idCopied: "ID kopiert",
        copyFailed: "Die ID ließ sich nicht kopieren",
        copyFailedHint: "Die ganze ID ist jetzt markiert. Kopier sie selbst.",
        fullId: "Ganze ID",
        working: "Wird ausgeführt…",
        rowsShown: "8 von 23 angezeigt",
        showAll: "Alle anzeigen",
        showMore: "Mehr anzeigen",
        slowHint: "Das dauert länger als üblich. Wenn nichts passiert, frag im Chat noch mal nach.",
        cancelled: "Abgebrochen. Frag im Chat noch mal nach dieser Ansicht.",
        viewErrorTitle: "Die Ansicht konnte nicht geladen werden",
        viewMissing: "Diese App kann die Ansicht nicht anzeigen. Frag im Chat noch mal nach ihr.",
        viewCrashed: "Dieses Element konnte nicht angezeigt werden.",
        enterFullscreen: "Vollbild",
        exitFullscreen: "Vollbild verlassen",
        reloadedAt: "Neu geladen um 14:32 Uhr",
      })
    }
  })

  it("falls back to English for English, unsupported and missing locales", () => {
    for (const tag of ["en-US", "fr-FR", undefined]) {
      expect(rendered(tag)).toEqual({
        loadingView: "Loading view…",
        zoomIn: "Zoom in",
        zoomOut: "Zoom out",
        fitViewport: "Fit to viewport",
        retry: "Try again",
        refreshFailed: "Couldn't refresh this view",
        refreshStale: "You're seeing the last loaded state.",
        askAiDefault: "Analyze in chat",
        openInVendor: "Open in CIB seven",
        openInEngine: "Open in engine cockpit",
        opensInNewTab: "In CIB seven öffnen (opens in a new tab)",
        copyId: "Copy 5f0ce78e…",
        idCopied: "ID copied",
        copyFailed: "Couldn't copy the ID",
        copyFailedHint: "The full ID is now selected. Copy it yourself.",
        fullId: "Full ID",
        working: "Working…",
        rowsShown: "8 of 23 shown",
        showAll: "Show all",
        showMore: "Show more",
        slowHint: "This is taking longer than usual. If nothing happens, ask in the chat again.",
        cancelled: "Cancelled. Ask in the chat to open this view again.",
        viewErrorTitle: "This view couldn't be loaded",
        viewMissing: "This app can't show this view. Ask in the chat to open it again.",
        viewCrashed: "This element couldn't be displayed.",
        enterFullscreen: "Fullscreen",
        exitFullscreen: "Exit fullscreen",
        reloadedAt: "Reloaded at 14:32",
      })
    }
  })
})
