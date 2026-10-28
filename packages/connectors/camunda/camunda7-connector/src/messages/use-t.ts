import { createUseT, type T } from "@miragon/pulse-widget-shell/widgets"
import { translator } from "./index.js"

export type { T }

export const useT = createUseT(translator)
