import { createTranslator, type Catalogs } from "@miragon/mcp-toolkit-core"
import { enSweep } from "./en.sweep.js"
import { deSweep } from "./de.sweep.js"
import { enServer } from "./en.server.js"
import { deServer } from "./de.server.js"
import { enAskAi } from "./en.ask-ai.js"
import { deAskAi } from "./de.ask-ai.js"

/** `en` is the fallback. */
const catalogs: Catalogs = {
  en: { ...enSweep, ...enServer, ...enAskAi },
  de: { ...deSweep, ...deServer, ...deAskAi },
}

export const translator = createTranslator(catalogs)
