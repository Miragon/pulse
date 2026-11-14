/**
 * The labels bpmn-js draws on a BPMN canvas, as its `textRenderer` config: bpmn-js's own font
 * stack and sizes (Arial, 12 px inside a shape, 11 px beside it, line height 1.2), the ones
 * Camunda Modeler and bpmn.io draw with. Pulse mostly shows diagrams drawn there, whose external
 * label boxes are sized for Arial; Geist is up to 8 % wider, so a label that fits in the modeler
 * would wrap. A named deviation from the guide (§4, its note on the canvas, which asks for Geist
 * on SVG text) on every surface that draws a diagram: widget-shell's `useBpmnViewer` (the cockpit)
 * and the webview of Pulse for VS Code and Pulse for Orca hand bpmn-js this one object, so a
 * change of bpmn-js's defaults cannot split them. The sizes are the diagram's units, which the
 * canvas zooms, not text on the type scale (`TYPE_SCALE`). The chrome around the canvas, its
 * tooltips and popups, the count badges and every other overlay stay in Geist.
 */
export const BPMN_LABEL_STYLE = {
  defaultStyle: {
    fontFamily: "Arial, sans-serif",
    fontSize: 12,
    fontWeight: "normal",
    lineHeight: 1.2,
  },
  externalStyle: { fontSize: 11, lineHeight: 1.2 },
} as const
