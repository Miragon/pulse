import {
  BPMN_TOKENS,
  type BpmnCanvas,
  type BpmnOverlays,
} from "@miragon/pulse-widget-shell/widgets"

/** Overlay colours from the kit's `BPMN_TOKENS`, so legend and diagram cannot drift. Red only for incidents. */
export const HIGHLIGHT_COLORS = {
  running: BPMN_TOKENS.running,
  openTask: BPMN_TOKENS.openTask,
  incident: BPMN_TOKENS.incident,
  instanceBadge: BPMN_TOKENS.instanceBadge,
  incidentBadge: BPMN_TOKENS.incidentBadge,
} as const

/** Priority `incident > open-task > active`: lower markers are skipped, so no activity gets two competing fills. */
export type BpmnHighlight =
  | { kind: "active"; activityIds: ReadonlyArray<string> }
  | {
      kind: "incident"
      activityIds: ReadonlyArray<string>
      /** Open-incident count badge per activity. */
      counts?: ReadonlyArray<{ activityId: string; count: number }>
    }
  | {
      kind: "failed-jobs"
      /** Failed-job count badge, whether or not an incident exists yet. */
      counts: ReadonlyArray<{ activityId: string; count: number }>
    }
  | { kind: "open-task"; activityIds: ReadonlyArray<string> }
  | {
      kind: "instance-count"
      counts: ReadonlyArray<{ activityId: string; count: number }>
    }

/** Order-preserving dedupe. */
export function dedupe(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values))
}

function safeAddMarker(canvas: Pick<BpmnCanvas, "addMarker">, activityId: string, marker: string) {
  try {
    canvas.addMarker(activityId, marker)
  } catch {
    /* activity may not exist in the rendered diagram */
  }
}

function safeAddOverlay(
  overlays: BpmnOverlays,
  activityId: string,
  overlay: { position: object; html: string },
) {
  try {
    overlays.add(activityId, overlay)
  } catch {
    /* activity may not exist in the rendered diagram */
  }
}

export function applyHighlights(
  canvas: Pick<BpmnCanvas, "addMarker">,
  overlays: BpmnOverlays,
  highlights: ReadonlyArray<BpmnHighlight>,
) {
  const { incidentIds, openTaskIds, activeIds } = collectMarkerIds(highlights)
  applyMarkers(canvas, incidentIds, openTaskIds, activeIds)
  applyCountOverlays(overlays, highlights)
}

function collectMarkerIds(highlights: ReadonlyArray<BpmnHighlight>) {
  const incidentIds: string[] = []
  const openTaskIds: string[] = []
  const activeIds: string[] = []

  for (const h of highlights) {
    if (h.kind === "incident") {
      incidentIds.push(...h.activityIds)
    } else if (h.kind === "open-task") {
      openTaskIds.push(...h.activityIds)
    } else if (h.kind === "active") {
      activeIds.push(...h.activityIds)
    }
  }

  return { incidentIds, openTaskIds, activeIds }
}

function applyMarkers(
  canvas: Pick<BpmnCanvas, "addMarker">,
  incidentIds: ReadonlyArray<string>,
  openTaskIds: ReadonlyArray<string>,
  activeIds: ReadonlyArray<string>,
) {
  const incidentSet = new Set(incidentIds)
  const openTaskSet = new Set(openTaskIds)

  for (const id of dedupe(activeIds)) {
    if (incidentSet.has(id) || openTaskSet.has(id)) continue
    safeAddMarker(canvas, id, "highlight-running")
  }
  for (const id of dedupe(openTaskIds)) {
    if (incidentSet.has(id)) continue
    safeAddMarker(canvas, id, "highlight-open-user-task")
  }
  for (const id of dedupe(incidentIds)) {
    safeAddMarker(canvas, id, "highlight-incident")
  }
}

function applyCountOverlays(overlays: BpmnOverlays, highlights: ReadonlyArray<BpmnHighlight>) {
  for (const h of highlights) {
    if (h.kind === "incident" && h.counts) {
      addRedCountOverlays(overlays, h.counts)
    } else if (h.kind === "failed-jobs") {
      addRedCountOverlays(overlays, h.counts)
    } else if (h.kind === "instance-count") {
      addInstanceCountOverlays(overlays, h.counts)
    }
  }
}

function addInstanceCountOverlays(
  overlays: BpmnOverlays,
  counts: ReadonlyArray<{ activityId: string; count: number }>,
) {
  for (const c of counts) {
    const safeCount = Number(c.count) || 0
    if (safeCount <= 0) continue
    safeAddOverlay(overlays, c.activityId, {
      position: { top: -14, right: -14 },
      html: `<div class="bpmn-overlay-badge bpmn-overlay-badge--instance-count">${safeCount}</div>`,
    })
  }
}

function addRedCountOverlays(
  overlays: BpmnOverlays,
  counts: ReadonlyArray<{ activityId: string; count: number }>,
) {
  for (const c of counts) {
    const safeCount = Number(c.count) || 0
    if (safeCount <= 0) continue
    safeAddOverlay(overlays, c.activityId, {
      position: { top: -14, left: -14 },
      html: `<div class="bpmn-overlay-badge bpmn-overlay-badge--incident-count">${safeCount}</div>`,
    })
  }
}
