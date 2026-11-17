import type { MessageCatalog } from "@miragon/pulse-widget-shell/widgets"
import { countOf } from "./plural.js"

/**
 * The board view's chrome: its bar, its strips and its row action. The tiles word themselves
 * (@miragon/pulse-blocks, in the host's language).
 */
export const enBoard: MessageCatalog = {
  "board.loading": "Loading the board…",
  "board.empty": "This board shows nothing yet.",
  "board.refresh": "Refresh",
  "board.refreshing": "Refreshing…",
  "board.refreshTitle": "Read every engine of this board again",
  "board.refreshFailed": "Couldn't refresh this board",
  "board.asOf": ({ time }) => `As of ${String(time)}`,
  "board.engines": ({ count, names }) => `${countOf(count, "engine", "engines")}: ${String(names)}`,
  "board.enginesLabel": "Engines of this board",
  "board.openEngineTitle": ({ engine }) => `Open the overview of ${String(engine)}`,
  "board.engine.running": ({ count }) => `${String(count)} running`,
  "board.engine.withIncident": ({ count }) => `${String(count)} with incident`,
  "board.engineNotRead": ({ engine }) => `Can't read ${String(engine)}`,
  "board.engineNotReadHint":
    "The tiles show what the other engines answered; its own answer is under Details.",
  "board.hint.unreachable":
    "Check that the engine is running. Until then, the tiles show what the other engines answered.",
  "board.hint.profileRefused":
    "Whoever runs this server finds the reason in its log at startup and can fix the profile. Until then, the tiles show what the other engines answered.",
  "board.notConfigured": ({ engine }) =>
    `${String(engine)} is not among the engines of this server.`,
  "board.notConfiguredHint":
    "Its tiles stay empty until whoever runs the server adds a profile of that name.",
  "board.notes": ({ count }) => `${countOf(count, "note", "notes")} on this board.`,
  "board.open": "Open",
  "board.colActions": "Actions",
}
