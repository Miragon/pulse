import type { CdTokenName } from "@miragon/pulse-ui"

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

/** bpmn-js draws plain shapes at 2. */
const STATE_STROKE = 2
const OPEN_TASK_STROKE = 3
const OPEN_TASK_DASH = "8 4"

const { incident, running, openTask, instanceBadge, incidentBadge } = BPMN_TOKENS

/**
 * What a marker paints: the marked shape's own outline, the first part of its own visual (a
 * task's rectangle, an event's circle, a gateway's diamond). Child combinators only, so a marker
 * on the process itself (an activity instance tree's root names the process, whose graphics are
 * the layer of every element) or on an expanded subprocess paints nothing inside it, and never a
 * text: a label keeps its ink, the task's name too.
 */
const outline = (marker: string) => `.djs-shape.${marker} > .djs-visual > :first-child:not(text)`

/** Inject it once per document with {@link injectBpmnOverlayCss}. */
export const BPMN_OVERLAY_CSS = `
${outline("highlight-running")} {
  fill: ${cdVar(running.fill)} !important;
  stroke: ${cdVar(running.stroke)} !important;
  stroke-width: ${STATE_STROKE}px !important;
}
${outline("highlight-open-user-task")} {
  fill: ${cdVar(openTask.fill)} !important;
  stroke: ${cdVar(openTask.stroke)} !important;
  stroke-width: ${OPEN_TASK_STROKE}px !important;
  stroke-dasharray: ${OPEN_TASK_DASH} !important;
}
${outline("highlight-incident")} {
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
