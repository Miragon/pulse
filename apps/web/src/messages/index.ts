import { createUseT } from "@miragon/pulse-ui"
import { createTranslator } from "@miragon/pulse-widget-shell/widgets"
import { de } from "./de.js"
import { en } from "./en.js"

/** The web app's catalogs by language: the view's own (German or English, as the page resolved). */
export const catalogs = { en, de }

/** The app's words in the language the page's providers resolved (`useLocale`). */
export const useT = createUseT(createTranslator(catalogs))
