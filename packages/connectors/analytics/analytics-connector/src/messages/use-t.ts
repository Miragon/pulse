import { createUseT, type T } from "@miragon/pulse-ui"
import { translator } from "./index.js"

export type { T }

/** Modules keep separate catalogs but share the one locale. */
export const useT = createUseT(translator)
