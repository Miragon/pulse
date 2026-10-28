import { CD_TOKENS, type CdTokenName } from "@miragon/mcp-toolkit-ui"

/** Every colour the BPMN canvas paints, as a `--cd-*` token named once; `bpmn-tokens.test.ts` checks drift and contrast. Red only for incidents; an open user task differs by a heavier dash (shape, not colour) and does not pulse, so reduced motion has nothing to stop. */
export const BPMN_TOKENS = {
  /** The paper: always light, in every theme. */
  paper: "weiss",
  incident: { stroke: "danger", fill: "danger-soft" },
  running: { stroke: "blau", fill: "info-soft" },
  openTask: { stroke: "blau", fill: "info-soft" },
  instanceBadge: { fill: "blau", text: "weiss" },
  incidentBadge: { fill: "danger", text: "weiss" },
  /** The data-viz ramp of the heatmap: one hue, pale to full blue. */
  heat: { from: "info-soft", to: "blau" },
} as const satisfies {
  paper: CdTokenName
  incident: { stroke: CdTokenName; fill: CdTokenName }
  running: { stroke: CdTokenName; fill: CdTokenName }
  openTask: { stroke: CdTokenName; fill: CdTokenName }
  instanceBadge: { fill: CdTokenName; text: CdTokenName }
  incidentBadge: { fill: CdTokenName; text: CdTokenName }
  heat: { from: CdTokenName; to: CdTokenName }
}

export function cdVar(name: CdTokenName): string {
  return `var(--cd-${name})`
}

/** For code that paints numbers, never for CSS. */
export function cdValue(name: CdTokenName): string {
  return CD_TOKENS[name]
}

/** bpmn-js draws plain shapes at 2. */
const STATE_STROKE = 2
const OPEN_TASK_STROKE = 3
const OPEN_TASK_DASH = "8 4"

const { incident, running, openTask, instanceBadge, incidentBadge } = BPMN_TOKENS

/** Inject it once per document with {@link injectBpmnOverlayCss}. */
export const BPMN_OVERLAY_CSS = `
.highlight-running:not(.djs-connection) .djs-visual > :nth-child(1) {
  fill: ${cdVar(running.fill)} !important;
  stroke: ${cdVar(running.stroke)} !important;
  stroke-width: ${STATE_STROKE}px !important;
}
.highlight-open-user-task:not(.djs-connection) .djs-visual > :nth-child(1) {
  fill: ${cdVar(openTask.fill)} !important;
  stroke: ${cdVar(openTask.stroke)} !important;
  stroke-width: ${OPEN_TASK_STROKE}px !important;
  stroke-dasharray: ${OPEN_TASK_DASH} !important;
}
.highlight-incident:not(.djs-connection) .djs-visual > :nth-child(1) {
  fill: ${cdVar(incident.fill)} !important;
  stroke: ${cdVar(incident.stroke)} !important;
  stroke-width: ${STATE_STROKE}px !important;
}
.bpmn-overlay-badge {
  border-radius: var(--cd-radius-pill);
  height: 22px;
  min-width: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  box-shadow: var(--cd-shadow-1);
}
.bpmn-overlay-badge--instance-count {
  background: ${cdVar(instanceBadge.fill)};
  color: ${cdVar(instanceBadge.text)};
}
.bpmn-overlay-badge--incident-count {
  background: ${cdVar(incidentBadge.fill)};
  color: ${cdVar(incidentBadge.text)};
}
`

const STYLE_ID = "bpmn-overlay-css"

export function injectBpmnOverlayCss(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement("style")
  style.id = STYLE_ID
  style.textContent = BPMN_OVERLAY_CSS
  doc.head.appendChild(style)
}

/** The legend swatch of a marker: its tint with a stroke-coloured edge, as an inline style. */
export function markerSwatch(marker: { stroke: CdTokenName; fill: CdTokenName }): {
  borderColor: string
  background: string
} {
  return { borderColor: cdVar(marker.stroke), background: cdVar(marker.fill) }
}

export function badgeSwatch(badge: { fill: CdTokenName; text: CdTokenName }): {
  background: string
  color: string
} {
  return { background: cdVar(badge.fill), color: cdVar(badge.text) }
}
