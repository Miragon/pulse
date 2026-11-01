import { createUseT, type T } from "@miragon/pulse-ui"
import { createTranslator } from "@miragon/pulse-widget-shell/widgets"
import { catalogs } from "./index.js"

export type { T }

export const translator = createTranslator(catalogs)

export const useT = createUseT(translator)
