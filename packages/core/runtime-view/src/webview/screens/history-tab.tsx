import { HistoryTable } from "@miragon/pulse-blocks"
import type { PathRow } from "../../core/protocol/index.js"
import { useInstanceSlots } from "./instance-slots.js"

export interface HistoryTabProps {
  readonly path: readonly PathRow[]
  readonly elementName: (elementId: string) => string
}

export function HistoryTab({ path, elementName }: HistoryTabProps) {
  return <HistoryTable path={path} nameOf={elementName} slots={useInstanceSlots()} />
}
