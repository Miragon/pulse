import type { CollapsedShapes } from "@miragon/pulse-board/builder"
import type { ElementMarker } from "../protocol/index.js"

export class SubProcessRollUp {
  static markers(markers: readonly ElementMarker[], shapes: CollapsedShapes): ElementMarker[] {
    return markers.flatMap((marker) => [
      marker,
      ...shapes.around(marker.elementId).map((elementId) => ({ elementId, kind: marker.kind })),
    ])
  }
}
