// @vitest-environment happy-dom
import { describe, expect, it } from "vitest"
import * as bpmn from "./index.js"

/**
 * The published `./bpmn` entry, name by name: a name added here is a promise to every customer, a
 * name dropped a breaking change, so either is a decision made in review, not a side effect. Types
 * are erased at runtime: this locks the runtime names.
 */
describe("the ./bpmn entry", () => {
  it("exports exactly these runtime names", () => {
    expect(Object.keys(bpmn).sort()).toEqual([
      "BPMN_CANVAS_SLOT",
      "BPMN_CANVAS_VARS",
      "BPMN_OVERLAY_CSS",
      "BPMN_TOKENS",
      "BpmnDiagram",
      "BpmnZoomControls",
      "CanvasBadge",
      "DiagramLegend",
      "cdVar",
      "injectBpmnOverlayCss",
      "parseBpmnNames",
      "readBpmnNames",
      "useBpmnViewer",
    ])
  })
})
