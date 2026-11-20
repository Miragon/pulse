import { CollapsedShapes } from "@miragon/pulse-board/builder"
import type { InstanceDetail } from "@miragon/pulse-engine-core"
import type { MarkerData } from "@miragon/pulse-screens"
import { BpmnStructure } from "../bpmn/bpmn-structure.js"
import type { ElementMarker } from "../protocol/index.js"

export class InstanceMarkers {
  static of(
    detail: InstanceDetail,
    diagramXml: string,
    located: readonly MarkerData[],
  ): ElementMarker[] {
    return [...located, ...InstanceMarkers.taken(detail, diagramXml)]
  }

  private static taken(detail: InstanceDetail, diagramXml: string): ElementMarker[] {
    const shapes = CollapsedShapes.of(diagramXml)
    const rootId = detail.instance.id
    const ended = new Set<string>(
      detail.path.filter((run) => run.endedAt !== undefined).map((run) => run.elementId),
    )
    const reached = new Set<string>([
      ...detail.path.map((run) => run.elementId),
      ...detail.waitStates
        .filter((waitState) => waitState.instanceId === rootId)
        .map((waitState) => waitState.elementId),
    ])
    return BpmnStructure.of(diagramXml)
      .flowsBetween(ended, reached)
      .filter((flowId) => shapes.around(flowId).length === 0)
      .map((flowId) => ({ elementId: flowId, kind: "taken" }))
  }
}
