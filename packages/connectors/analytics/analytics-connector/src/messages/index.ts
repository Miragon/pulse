import type { Catalogs } from "@miragon/pulse-widget-shell/widgets"
import { enSweep } from "./en.sweep.js"
import { deSweep } from "./de.sweep.js"
import { enAskAi } from "./en.ask-ai.js"
import { deAskAi } from "./de.ask-ai.js"

/**
 * The widget catalogs (`use-t.ts` builds the translator); `en` is the fallback. The model
 * summaries live apart in `en.server.ts` (`summary.ts`), so the widget bundle carries none.
 */
export const catalogs: Catalogs = {
  en: { ...enSweep, ...enAskAi },
  de: { ...deSweep, ...deAskAi },
}
