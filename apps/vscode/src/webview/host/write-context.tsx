import { createContext } from "preact"
import { useContext } from "preact/hooks"
import type { WriteState } from "../../core/protocol/index.js"

export const WriteContext = createContext<WriteState | undefined>(undefined)

export function useWriteState(): WriteState | undefined {
  return useContext(WriteContext)
}
