import { createContext, useContext } from "react"
import type { WriteState } from "../../core/protocol/index.js"

export const WriteContext = createContext<WriteState | undefined>(undefined)

export function useWriteState(): WriteState | undefined {
  return useContext(WriteContext)
}
