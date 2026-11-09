import type { BoardTarget } from "../../../core/protocol/index.js"
import { useHost } from "../../host/host-context.js"

export function useOpenTarget(): (target: BoardTarget, toSide: boolean) => void {
  const host = useHost()
  return (target, toSide) => {
    if (target.bpmnProcessId === undefined) {
      host.post({ type: "openBoardEngine", engine: target.engine, toSide })
      return
    }
    host.post({
      type: "openBoardProcess",
      engine: target.engine,
      bpmnProcessId: target.bpmnProcessId,
      filter: target.filter,
      toSide,
    })
  }
}
