import { useMemo } from "react"
import type { BoardDiagramProps } from "@miragon/pulse-blocks"
import type { DiagramDecoration } from "@miragon/pulse-ui/bpmn"
import { BpmnDiagram } from "../bpmn-diagram.js"

/** The tile's frame is 320 px (`h-80`) inside its 1 px border. */
const DIAGRAM_HEIGHT = 318

type Badge = BoardDiagramProps["badges"][number]

/**
 * As the process flow's "Running" draws it, in the one badge scheme: an element's open root
 * incidents in red (its outline too), apart and quiet the incidents of the instances it called,
 * never part of the incident count (owner decision D2, amended on 2026-11-19), what runs there in
 * blue. The board names what runs `active`, the diagram `running`.
 */
export function boardDecorations(badges: readonly Badge[]): DiagramDecoration[] {
  return badges.map((badge) => ({
    elementId: badge.elementId,
    counts: [
      { kind: "incidents", count: badge.incidents },
      { kind: "incidentsInCalledInstances", count: badge.incidentsInCalledInstances },
      { kind: "running", count: badge.active },
    ],
    incident: badge.incidents > 0,
  }))
}

/**
 * The cockpit's diagram of a tile: the version the board drew, its XML read by id on its engine
 * (`engine_bpmn_xml_data`, kept for good), with the tile's counts on its elements. The tile's
 * button opens the process; the canvas itself opens nothing.
 */
export function BoardDiagram({ engine, definition, badges }: BoardDiagramProps) {
  const decorations = useMemo(() => boardDecorations(badges), [badges])
  return (
    <BpmnDiagram
      definitionId={definition.id}
      engineId={engine}
      height={DIAGRAM_HEIGHT}
      decorations={decorations}
    />
  )
}
