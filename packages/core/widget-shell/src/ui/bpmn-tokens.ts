import type { CdTokenName, ROLE_TOKENS } from "@miragon/pulse-ui"

/**
 * The light canvas: every colour it paints, as a `--cd-*` token named once; `bpmn-tokens.test.ts`
 * checks drift and contrast. Red only for incidents; an open user task differs by a heavier dash
 * (shape, not colour) and does not pulse, so reduced motion has nothing to stop. The dark canvas
 * is {@link BPMN_DARK_ROLES}; the count badges are the same in both.
 */
export const BPMN_TOKENS = {
  /** The paper, and the fill of every shape on it. */
  paper: "weiss",
  /** What bpmn-js draws with: strokes, markers and labels. */
  ink: "schwarz",
  incident: { stroke: "danger", fill: "danger-soft" },
  running: { stroke: "blau", fill: "info-soft" },
  openTask: { stroke: "blau", fill: "info-soft" },
  instanceBadge: { fill: "blau", text: "weiss" },
  incidentBadge: { fill: "danger", text: "weiss" },
  /** The data-viz ramp of the heatmap: one hue, pale to full blue, multiplied into the drawing. */
  heat: { from: "info-soft", to: "blau" },
} as const satisfies {
  paper: CdTokenName
  ink: CdTokenName
  incident: { stroke: CdTokenName; fill: CdTokenName }
  running: { stroke: CdTokenName; fill: CdTokenName }
  openTask: { stroke: CdTokenName; fill: CdTokenName }
  instanceBadge: { fill: CdTokenName; text: CdTokenName }
  incidentBadge: { fill: CdTokenName; text: CdTokenName }
  heat: { from: CdTokenName; to: CdTokenName }
}

type RoleToken = (typeof ROLE_TOKENS)[number]

/**
 * The dark canvas, as the webview of the editors paints its own (owner decision D10, point 7):
 * pulse-ui's roles, which hold the guide's dark `--cd-ui-*` values (its `theme-css.test.ts`), so a
 * host's palette reaches the paper and the ink as it reaches every surface of the view. The paper
 * is the ground (grund), the shapes' fill too; the ink the text; a marker its tone's `-hell` value
 * on the neutral status surface. A brand may override these roles, so their pairs are pulse-ui's
 * `ROLE_CONTRAST_PAIRS` too, which a brand's own test measures. The heat ramp's ends are palette
 * tokens: the layer computes its colours from their values, screened into the drawing so the
 * labels keep their ink (derived from point 7, not decided by the owner yet: the root CLAUDE.md's
 * data-viz deviation).
 */
const BPMN_DARK_ROLES = {
  paper: "--background",
  ink: "--foreground",
  incident: { stroke: "--danger", fill: "--danger-surface" },
  running: { stroke: "--info", fill: "--info-surface" },
  openTask: { stroke: "--info", fill: "--info-surface" },
  /** bpmn.io's link (a licence term): bpmn-js writes its colour for light paper. */
  credit: "--muted-foreground",
  heat: { from: "schwarz", to: "blau" },
} as const satisfies {
  paper: RoleToken
  ink: RoleToken
  incident: { stroke: RoleToken; fill: RoleToken }
  running: { stroke: RoleToken; fill: RoleToken }
  openTask: { stroke: RoleToken; fill: RoleToken }
  credit: RoleToken
  heat: { from: CdTokenName; to: CdTokenName }
}

export function cdVar(name: CdTokenName): string {
  return `var(--cd-${name})`
}

/**
 * The canvas's own variables, which its frame declares per mode: bpmn-js draws with the first
 * two (`BPMN_RENDERER_COLORS`), the markers, the badges and a heat layer read the rest.
 */
export const BPMN_CANVAS_VARS = {
  paper: "--bpmn-paper",
  ink: "--bpmn-ink",
  incidentStroke: "--bpmn-incident-stroke",
  incidentFill: "--bpmn-incident-fill",
  runningStroke: "--bpmn-running-stroke",
  runningFill: "--bpmn-running-fill",
  openTaskStroke: "--bpmn-open-task-stroke",
  openTaskFill: "--bpmn-open-task-fill",
  badgeShadow: "--bpmn-badge-shadow",
  /** The heat ramp's ends, each a `--cd-*` token's value (`#RRGGBB`). */
  heatFrom: "--bpmn-heat-from",
  heatTo: "--bpmn-heat-to",
  /** How a heat layer blends into the drawing: `multiply` on light paper, `screen` on dark. */
  heatBlend: "--bpmn-heat-blend",
} as const

type CanvasVar = (typeof BPMN_CANVAS_VARS)[keyof typeof BPMN_CANVAS_VARS]

/** A canvas variable or one of pulse-ui's roles, as a value. */
const v = (name: CanvasVar | RoleToken) => `var(${name})`
const V = BPMN_CANVAS_VARS
const L = BPMN_TOKENS
const D = BPMN_DARK_ROLES

/** What each canvas variable holds per mode, as the frame declares it (`BPMN_OVERLAY_CSS`). */
export const BPMN_CANVAS_ROLES: Readonly<Record<"light" | "dark", Record<CanvasVar, string>>> = {
  light: {
    [V.paper]: cdVar(L.paper),
    [V.ink]: cdVar(L.ink),
    [V.incidentStroke]: cdVar(L.incident.stroke),
    [V.incidentFill]: cdVar(L.incident.fill),
    [V.runningStroke]: cdVar(L.running.stroke),
    [V.runningFill]: cdVar(L.running.fill),
    [V.openTaskStroke]: cdVar(L.openTask.stroke),
    [V.openTaskFill]: cdVar(L.openTask.fill),
    [V.badgeShadow]: "var(--cd-shadow-1)",
    [V.heatFrom]: cdVar(L.heat.from),
    [V.heatTo]: cdVar(L.heat.to),
    [V.heatBlend]: "multiply",
  },
  dark: {
    [V.paper]: v(D.paper),
    [V.ink]: v(D.ink),
    [V.incidentStroke]: v(D.incident.stroke),
    [V.incidentFill]: v(D.incident.fill),
    [V.runningStroke]: v(D.running.stroke),
    [V.runningFill]: v(D.running.fill),
    [V.openTaskStroke]: v(D.openTask.stroke),
    [V.openTaskFill]: v(D.openTask.fill),
    // A badge sits on a shape's corner: a ring of paper parts it from the light stroke under it.
    [V.badgeShadow]: `0 0 0 2px ${v(V.paper)}`,
    [V.heatFrom]: cdVar(D.heat.from),
    [V.heatTo]: cdVar(D.heat.to),
    [V.heatBlend]: "screen",
  },
}

type HeatVar = typeof V.heatFrom | typeof V.heatTo | typeof V.heatBlend

/**
 * Under forced colours (a Windows contrast theme) the drawing takes the system's palette, as the
 * webview's markers and badges do (its markers in Highlight, its badges in Canvas and CanvasText).
 * The browser forces no SVG paint, so the canvas sets it: the paper and the shapes' fill Canvas,
 * the ink CanvasText, a marker's outline Highlight on Canvas; a light or dark mode of the page
 * cannot leave a flow in the palette's own ground colour. The heat keeps its ramp, blended by the
 * palette's lightness (`prefers-color-scheme`, which the browser derives from Canvas there).
 */
export const BPMN_FORCED_CANVAS: Readonly<Record<Exclude<CanvasVar, HeatVar>, string>> = {
  [V.paper]: "Canvas",
  [V.ink]: "CanvasText",
  [V.incidentStroke]: "Highlight",
  [V.incidentFill]: "Canvas",
  [V.runningStroke]: "Highlight",
  [V.runningFill]: "Canvas",
  [V.openTaskStroke]: "Highlight",
  [V.openTaskFill]: "Canvas",
  [V.badgeShadow]: "none",
}

/** The heat's variables of a mode: its ramp and blend, which forced colours pick by lightness. */
function heatOf(mode: "light" | "dark"): Record<HeatVar, string> {
  const roles = BPMN_CANVAS_ROLES[mode]
  return {
    [V.heatFrom]: roles[V.heatFrom],
    [V.heatTo]: roles[V.heatTo],
    [V.heatBlend]: roles[V.heatBlend],
  }
}

/** What bpmn-js draws with by default (its `bpmnRenderer` config): the canvas's paper and ink. */
export const BPMN_RENDERER_COLORS = {
  defaultFillColor: v(V.paper),
  defaultStrokeColor: v(V.ink),
  defaultLabelColor: v(V.ink),
} as const

/** The frame bpmn-js draws into (`useBpmnViewer` marks it), or a drawing that takes its paper. */
export const BPMN_CANVAS_SLOT = "bpmn-canvas"

const CANVAS = `[data-slot="${BPMN_CANVAS_SLOT}"]`
const DARK_SCOPES = '.dark, [data-theme="dark"], [data-theme-mode="dark"], [data-cd-theme="dark"]'
const LIGHT_ISLANDS = '[data-theme-mode="light"], [data-cd-theme="light"]'

/**
 * pulse-ui's `dark:` variant on the canvas: dark in the NEAREST mode scope, so the canvas takes
 * the mode its roles resolve in (a dark scope with no light island in between, or a dark scope
 * nested in a light island).
 */
export const BPMN_DARK_CANVAS = `${CANVAS}:is(:is(${DARK_SCOPES}) *:not(:is(${LIGHT_ISLANDS}) *), :is(${LIGHT_ISLANDS}) :is(${DARK_SCOPES}) *:not(:is(${LIGHT_ISLANDS}) :is(${DARK_SCOPES}) :is(${LIGHT_ISLANDS}) *))`

/** A block's declarations; `!important` under forced colours, so they win over every mode. */
const declare = (
  roles: Readonly<Partial<Record<CanvasVar, string>>>,
  { indent = "  ", important = false } = {},
) =>
  Object.entries(roles)
    .map(([name, value]) => `${indent}${name}: ${value}${important ? " !important" : ""};`)
    .join("\n")

/** bpmn-js draws plain shapes at 2. */
const STATE_STROKE = 2
const OPEN_TASK_STROKE = 3
const OPEN_TASK_DASH = "8 4"
/** High contrast widens a state's outline, as the webview's. */
const CONTRAST_STROKE = 3

/** The guide's attribute for high contrast, on the element that carries the mode (pulse-ui's). */
export const BPMN_HIGH_CONTRAST = '[data-cd-kontrast="hoch"]'

const { instanceBadge, incidentBadge } = BPMN_TOKENS

/**
 * What a marker paints: the marked shape's own outline, the first part of its own visual (a
 * task's rectangle, an event's circle, a gateway's diamond). Child combinators only, so a marker
 * on the process itself (an activity instance tree's root names the process, whose graphics are
 * the layer of every element) or on an expanded subprocess paints nothing inside it, and never a
 * text: a label keeps its ink, the task's name too.
 */
const outline = (marker: string) => `.djs-shape.${marker} > .djs-visual > :first-child:not(text)`
const contrasted = (marker: string) => `${BPMN_HIGH_CONTRAST} ${outline(marker)}`

/**
 * The canvas in the theme (its paper, its ink, its markers per mode), the markers and the count
 * badges, in high contrast and under forced colours as the webview's canvas. High contrast
 * (`data-cd-kontrast="hoch"`): a running or incident outline at 3 px, a badge edged in the ink
 * instead of its ring. Forced colours: the drawing in the system's palette
 * ({@link BPMN_FORCED_CANVAS}), a badge Canvas with CanvasText, edged in CanvasText, bpmn.io's link
 * LinkText; an incident's outline 3 px and a running one 2 px, so the two differ by their width
 * where both are Highlight. `useBpmnViewer` injects it once per document
 * ({@link injectBpmnOverlayCss}).
 */
export const BPMN_OVERLAY_CSS = `
${CANVAS} {
${declare(BPMN_CANVAS_ROLES.light)}
  background-color: ${v(V.paper)};
}
${BPMN_DARK_CANVAS} {
${declare(BPMN_CANVAS_ROLES.dark)}
}
:where(${BPMN_DARK_CANVAS}) .bjs-powered-by {
  color: ${v(D.credit)} !important;
}
${outline("highlight-running")} {
  fill: ${v(V.runningFill)} !important;
  stroke: ${v(V.runningStroke)} !important;
  stroke-width: ${STATE_STROKE}px !important;
}
${outline("highlight-open-user-task")} {
  fill: ${v(V.openTaskFill)} !important;
  stroke: ${v(V.openTaskStroke)} !important;
  stroke-width: ${OPEN_TASK_STROKE}px !important;
  stroke-dasharray: ${OPEN_TASK_DASH} !important;
}
${outline("highlight-incident")} {
  fill: ${v(V.incidentFill)} !important;
  stroke: ${v(V.incidentStroke)} !important;
  stroke-width: ${STATE_STROKE}px !important;
}
${contrasted("highlight-running")},
${contrasted("highlight-incident")} {
  stroke-width: ${CONTRAST_STROKE}px !important;
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
  box-shadow: ${v(V.badgeShadow)};
}
.bpmn-overlay-badge--instance-count {
  background: ${cdVar(instanceBadge.fill)};
  color: ${cdVar(instanceBadge.text)};
}
.bpmn-overlay-badge--incident-count {
  background: ${cdVar(incidentBadge.fill)};
  color: ${cdVar(incidentBadge.text)};
}
${BPMN_HIGH_CONTRAST} .bpmn-overlay-badge {
  box-shadow: none;
  outline: 1px solid ${v(V.ink)};
}
@media (forced-colors: active) {
  ${CANVAS} {
    forced-color-adjust: none;
    border-color: CanvasText;
${declare({ ...BPMN_FORCED_CANVAS, ...heatOf("light") }, { indent: "    ", important: true })}
  }
  ${CANVAS} .bjs-powered-by {
    color: LinkText !important;
  }
  ${outline("highlight-incident")} {
    stroke-width: ${CONTRAST_STROKE}px !important;
  }
  ${contrasted("highlight-running")} {
    stroke-width: ${STATE_STROKE}px !important;
  }
  ${CANVAS} .bpmn-overlay-badge {
    border: 1px solid CanvasText;
    background: Canvas;
    color: CanvasText;
  }
}
@media (forced-colors: active) and (prefers-color-scheme: dark) {
  ${CANVAS} {
${declare(heatOf("dark"), { indent: "    ", important: true })}
  }
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
