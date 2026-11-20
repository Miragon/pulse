import type { ScreenLinkProps, ScreenOpenHow } from "@miragon/pulse-blocks"
import type { WebviewIntent } from "../../core/protocol/index.js"

type ScreenTarget = ScreenLinkProps["target"]

export class ScreenIntents {
  static of(target: ScreenTarget, how: ScreenOpenHow): WebviewIntent | undefined {
    switch (target.kind) {
      case "engine":
        return undefined
      case "process":
        return { type: "openProcess", bpmnProcessId: target.bpmnProcessId, toSide: how.toSide }
      case "version":
        return {
          type: "openDefinition",
          bpmnProcessId: target.bpmnProcessId,
          definitionId: target.definitionId,
        }
      case "instance":
        return { type: "openInstance", instanceId: target.instanceId, toSide: how.toSide }
    }
  }
}
