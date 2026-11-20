import { CollapsedShapes } from "@miragon/pulse-board/builder"
import type { InstanceDetail } from "@miragon/pulse-engine-core"
import type { MarkerData, MarkerKindCode } from "../format/instance-screen-data.js"
import type { InstanceTree } from "./instance-tree.js"

export class InstanceMarkers {
  constructor(
    private readonly detail: InstanceDetail,
    private readonly tree: InstanceTree,
    private readonly shapes: CollapsedShapes,
  ) {}

  static of(
    detail: InstanceDetail,
    tree: InstanceTree,
    diagramXml: string | undefined,
  ): MarkerData[] {
    const shapes = diagramXml === undefined ? new CollapsedShapes() : CollapsedShapes.of(diagramXml)
    return new InstanceMarkers(detail, tree, shapes).markers()
  }

  markers(): MarkerData[] {
    const located = [
      ...this.incidentMarkers(),
      ...this.waitingMarkers(),
      ...this.completedMarkers(),
    ]
    return InstanceMarkers.strongest(located.flatMap((marker) => this.rolledUp(marker)))
  }

  private static strongest(markers: readonly MarkerData[]): MarkerData[] {
    const byElement = new Map<string, MarkerData>()
    for (const marker of markers) {
      const known = byElement.get(marker.elementId)
      if (
        known === undefined ||
        InstanceMarkers.rank(marker.kind) > InstanceMarkers.rank(known.kind)
      ) {
        byElement.set(marker.elementId, marker)
      }
    }
    return [...byElement.values()]
  }

  private static rank(kind: MarkerKindCode): number {
    const ranks: Readonly<Record<MarkerKindCode, number>> = {
      incident: 3,
      incidentInCalledInstance: 2,
      waiting: 1,
      completed: 0,
    }
    return ranks[kind]
  }

  private rolledUp(marker: MarkerData): MarkerData[] {
    return [
      marker,
      ...this.shapes
        .around(marker.elementId)
        .map((elementId) => ({ elementId, kind: marker.kind })),
    ]
  }

  private incidentMarkers(): MarkerData[] {
    return this.detail.incidents.flatMap((incident): MarkerData[] => {
      const elementId = this.tree.locate(incident.instanceId, incident.elementId)
      if (elementId === undefined) {
        return []
      }
      const kind = this.tree.isRoot(incident.instanceId) ? "incident" : "incidentInCalledInstance"
      return [{ elementId, kind }]
    })
  }

  private waitingMarkers(): MarkerData[] {
    return this.detail.waitStates.flatMap((wait): MarkerData[] => {
      const elementId = this.tree.locate(wait.instanceId, wait.elementId)
      return elementId === undefined ? [] : [{ elementId, kind: "waiting" }]
    })
  }

  private completedMarkers(): MarkerData[] {
    return this.detail.path
      .filter((run) => run.endedAt !== undefined)
      .map((run) => ({ elementId: run.elementId, kind: "completed" }))
  }
}
