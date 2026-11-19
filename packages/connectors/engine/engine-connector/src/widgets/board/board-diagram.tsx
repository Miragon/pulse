import { useMemo } from "react"
import type { BoardDiagramProps } from "@miragon/pulse-blocks"
import { BpmnDiagram, type BpmnHighlight } from "../bpmn-diagram.js"

/** The tile's frame is 320 px (`h-80`) inside its 1 px border. */
const DIAGRAM_HEIGHT = 318

type Badge = BoardDiagramProps["badges"][number]

/** A badge's open incidents, those of the instances it called included. */
const incidentsOf = (badge: Badge) => badge.incidents + badge.incidentsInCalledInstances

/**
 * As the process flow's "Running" draws it: what runs at each element in blue, its open incidents
 * (those of the instances it called included) in red.
 */
export function boardHighlights(badges: readonly Badge[]): BpmnHighlight[] {
  const running = badges.filter((badge) => badge.active > 0)
  const failing = badges.filter((badge) => incidentsOf(badge) > 0)
  return [
    { kind: "active", activityIds: running.map((badge) => badge.elementId) },
    {
      kind: "instance-count",
      counts: running.map((badge) => ({ activityId: badge.elementId, count: badge.active })),
    },
    {
      kind: "incident",
      activityIds: failing.map((badge) => badge.elementId),
      counts: failing.map((badge) => ({
        activityId: badge.elementId,
        count: incidentsOf(badge),
      })),
    },
  ]
}

/**
 * The cockpit's diagram of a tile: the version the board drew, its XML read by id on its engine
 * (`engine_bpmn_xml_data`, kept for good), with the tile's counts on its elements. The tile's
 * button opens the process; the canvas itself opens nothing.
 */
export function BoardDiagram({ engine, definition, badges }: BoardDiagramProps) {
  const highlights = useMemo(() => boardHighlights(badges), [badges])
  return (
    <BpmnDiagram
      definitionId={definition.id}
      engineId={engine}
      height={DIAGRAM_HEIGHT}
      highlights={highlights}
    />
  )
}
