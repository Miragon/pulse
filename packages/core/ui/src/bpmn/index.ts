// The BPMN diagram for any React page, with no host: bpmn-js on the kit's themed canvas, Pulse's
// markers and count badges in the one badge scheme, the zoom bar, the fit and the legend; the
// viewer hook and the canvas's tokens for a surface's own diagram (the cockpit's heat); the one
// BPMN name reader. bpmn-js is an optional peer of the kit: only this entry imports it. Every
// module here reaches the rest of the kit through its root entry alone (`../index.js`), so a
// bundle of this entry shares the kit's React contexts with the root's bundle.
export {
  BpmnDiagram,
  type BpmnDiagramProps,
  type DiagramCountsProps,
  type DiagramElement,
  type DiagramSelectHow,
} from "./bpmn-diagram.js"
export { DiagramLegend, type DiagramLegendProps } from "./diagram-legend.js"
export { CanvasBadge, type CanvasBadgeProps } from "./canvas-badge.js"
export type {
  DiagramCount,
  DiagramCountKind,
  DiagramDecoration,
  DiagramMarker,
  DiagramMarkerKind,
} from "./diagram-marks.js"
export {
  BPMN_CANVAS_SLOT,
  BPMN_CANVAS_VARS,
  BPMN_TOKENS,
  BPMN_OVERLAY_CSS,
  injectBpmnOverlayCss,
  cdVar,
} from "./bpmn-tokens.js"
export {
  useBpmnViewer,
  type BpmnCanvas,
  type BpmnElement,
  type BpmnOverlays,
  type BpmnViewerWithGet,
  type UseBpmnViewerOptions,
  type UseBpmnViewerResult,
} from "./use-bpmn-viewer.js"
export { BpmnZoomControls, type BpmnZoomControlsProps } from "./bpmn-zoom-controls.js"
export { parseBpmnNames, readBpmnNames, type BpmnModelNames, type BpmnNames } from "./bpmn-names.js"
