import { createUseT, type T } from "@miragon/pulse-ui"
import { createTranslator } from "@miragon/pulse-widget-shell/widgets"
import { catalogs } from "./index.js"

export type { T }

export const translator = createTranslator(catalogs)

/** Modules keep separate catalogs but share the one locale. */
export const useT = createUseT(translator)
