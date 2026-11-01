import type { Catalogs } from "@miragon/pulse-widget-shell/widgets"
import { enSweep } from "./en.sweep.js"
import { deSweep } from "./de.sweep.js"
import { enServer } from "./en.server.js"
import { deServer } from "./de.server.js"
import { enAskAi } from "./en.ask-ai.js"
import { deAskAi } from "./de.ask-ai.js"

/**
 * Catalogs only: the widgets (`use-t.ts`) and the server (`server-locale.ts`) each build their own
 * translator, so neither bundle loads the other side's barrel. `en` is the fallback.
 */
export const catalogs: Catalogs = {
  en: { ...enSweep, ...enServer, ...enAskAi },
  de: { ...deSweep, ...deServer, ...deAskAi },
}
