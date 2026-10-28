import { createTranslator, type Catalogs } from "@miragon/mcp-toolkit-core"
import { enSweep } from "./en.sweep.js"
import { deSweep } from "./de.sweep.js"
import { enServer } from "./en.server.js"
import { deServer } from "./de.server.js"
import { enAskAi } from "./en.ask-ai.js"
import { deAskAi } from "./de.ask-ai.js"
import { enBuilder } from "./en.builder.js"
import { deBuilder } from "./de.builder.js"

/** `en` is the fallback. */
export const catalogs: Catalogs = {
  en: { ...enSweep, ...enServer, ...enAskAi, ...enBuilder },
  de: { ...deSweep, ...deServer, ...deAskAi, ...deBuilder },
}

export const translator = createTranslator(catalogs)
