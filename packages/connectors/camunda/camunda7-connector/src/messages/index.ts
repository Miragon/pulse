import type { Catalogs } from "@miragon/pulse-widget-shell/widgets"
import { en } from "./en.js"
import { de } from "./de.js"
import { enSweep } from "./en.sweep.js"
import { deSweep } from "./de.sweep.js"
import { enAskAi } from "./en.ask-ai.js"
import { deAskAi } from "./de.ask-ai.js"
import { enFeedback } from "./en.feedback.js"
import { deFeedback } from "./de.feedback.js"

/**
 * Catalogs only: the widgets (`use-t.ts`) and the server (`lib/server-locale.ts`) each build their
 * own translator, so neither bundle loads the other side's barrel. On a key clash the sweep
 * catalogs win (last spread).
 */
export const catalogs: Catalogs = {
  en: { ...en, ...enSweep, ...enAskAi, ...enFeedback },
  de: { ...de, ...deSweep, ...deAskAi, ...deFeedback },
}
