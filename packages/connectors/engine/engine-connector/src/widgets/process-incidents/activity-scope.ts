import type { ProcessIncidentsData } from "../../view-models.js"

export interface DiagramActivityFraction {
  affected: number
  total: number
  /** Outside X and Y. */
  olderVersionsOnly: number
}

/** #335 N60: the key-wide list over the diagram's total could read "3 of 2". */
export function diagramActivityFraction(
  data: Pick<
    ProcessIncidentsData,
    "activities" | "totalActivityCount" | "affectedDiagramActivityCount"
  >,
): DiagramActivityFraction | null {
  if (data.totalActivityCount === null || data.affectedDiagramActivityCount === null) return null
  return {
    affected: data.affectedDiagramActivityCount,
    total: data.totalActivityCount,
    olderVersionsOnly: data.activities.length - data.affectedDiagramActivityCount,
  }
}
