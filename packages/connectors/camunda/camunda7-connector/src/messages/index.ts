import { createTranslator, type Catalogs } from "@miragon/mcp-toolkit-core"
import { en } from "./en.js"
import { de } from "./de.js"
import { enSweep } from "./en.sweep.js"
import { deSweep } from "./de.sweep.js"
import { enAskAi } from "./en.ask-ai.js"
import { deAskAi } from "./de.ask-ai.js"
import { enFeedback } from "./en.feedback.js"
import { deFeedback } from "./de.feedback.js"

/** On a key clash the sweep catalogs win (last spread). */
export const catalogs: Catalogs = {
  en: { ...en, ...enSweep, ...enAskAi, ...enFeedback },
  de: { ...de, ...deSweep, ...deAskAi, ...deFeedback },
}

export const translator = createTranslator(catalogs)
