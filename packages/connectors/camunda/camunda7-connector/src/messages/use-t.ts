import { createUseT, type T } from "@miragon/pulse-ui"
import { translator } from "./index.js"

export type { T }

export const useT = createUseT(translator)
