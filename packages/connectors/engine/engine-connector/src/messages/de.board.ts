import type { MessageCatalog } from "@miragon/pulse-widget-shell/widgets"
import { countOf } from "./plural.js"

/** Die Texte rund um ein Board: Leiste, Streifen, Zeilenaktion. Die Kacheln texten sich selbst. */
export const deBoard: MessageCatalog = {
  "board.loading": "Board wird geladen…",
  "board.empty": "Dieses Board zeigt noch nichts.",
  "board.refresh": "Aktualisieren",
  "board.refreshing": "Wird aktualisiert…",
  "board.refreshTitle": "Alle Engines dieses Boards neu lesen",
  "board.refreshFailed": "Das Board ließ sich nicht aktualisieren",
  "board.asOf": ({ time }) => `Stand ${String(time)}`,
  "board.engines": ({ count, names }) => `${countOf(count, "Engine", "Engines")}: ${String(names)}`,
  "board.enginesLabel": "Engines dieses Boards",
  "board.openEngineTitle": ({ engine }) => `Übersicht von ${String(engine)} öffnen`,
  "board.engine.running": ({ count }) => `${String(count)} laufend`,
  "board.engine.withIncident": ({ count }) => `${String(count)} mit Incident`,
  "board.engineNotRead": ({ engine }) => `${String(engine)} ließ sich nicht lesen`,
  "board.engineNotReadHint":
    "Die Kacheln zeigen, was die anderen Engines geantwortet haben; ihre Antwort steht unter Details.",
  "board.hint.unreachable":
    "Prüf, ob die Engine läuft. Bis dahin zeigen die Kacheln, was die anderen Engines geantwortet haben.",
  "board.hint.profileRefused":
    "Die Person, die den Server betreibt, findet den Grund im Log beim Start und kann das Profil korrigieren. Bis dahin zeigen die Kacheln, was die anderen Engines geantwortet haben.",
  "board.notConfigured": ({ engine }) =>
    `${String(engine)} gehört nicht zu den Engines dieses Servers.`,
  "board.notConfiguredHint":
    "Die Kacheln dieser Engine bleiben leer, bis die Person, die den Server betreibt, ein Profil mit diesem Namen anlegt.",
  "board.notes": ({ count }) => `${countOf(count, "Hinweis", "Hinweise")} zu diesem Board.`,
}
