import { ElementId, type ElementStatistics } from "@miragon/pulse-engine-core"
import { describe, expect, test } from "vitest"
import { CollapsedShapes, DiagramBadges } from "../../src/builder/index.js"

const RETURN = `<bpmn:definitions id="Definitions_Return">
  <bpmn:process id="return">
    <bpmn:subProcess id="Inspect">
      <bpmn:incoming>Flow_In</bpmn:incoming>
      <bpmn:userTask id="Check" />
      <bpmn:subProcess id="Weigh" name="Weigh &quot;parcel&quot;">
        <bpmn:serviceTask id="ReadScale" />
      </bpmn:subProcess>
      <bpmn:subProcess id="Empty" />
    </bpmn:subProcess>
    <bpmn:transaction id="Refund">
      <bpmn:serviceTask id="PayRefund" />
    </bpmn:transaction>
    <bpmn:adHocSubProcess id="Notes">
      <bpmn:task id="WriteNote" />
    </bpmn:adHocSubProcess>
    <bpmn:task id="Close" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="return">
      <bpmndi:BPMNShape id="Shape_Inspect" bpmnElement="Inspect" />
      <bpmndi:BPMNShape id="Shape_Refund" bpmnElement="Refund" isExpanded="true" />
      <bpmndi:BPMNShape id="Shape_Unnamed" isExpanded="true" />
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`

function statistic(elementId: string, counts: Partial<ElementStatistics>): ElementStatistics {
  return {
    elementId: ElementId(elementId),
    active: 0,
    incidents: 0,
    incidentsInCalledInstances: 0,
    ...counts,
  }
}

describe("the collapsed shapes of a diagram", () => {
  test("name the collapsed sub-processes around an element, innermost first", () => {
    const shapes = CollapsedShapes.of(RETURN)

    expect(shapes.around("ReadScale")).toEqual(["Weigh", "Inspect"])
    expect(shapes.around("Check")).toEqual(["Inspect"])
    expect(shapes.around("Empty")).toEqual(["Inspect"])
    expect(shapes.around("WriteNote")).toEqual(["Notes"])
  })

  test("leave out an expanded sub-process and what lies outside every sub-process", () => {
    const shapes = CollapsedShapes.of(RETURN)

    expect(shapes.around("PayRefund")).toEqual([])
    expect(shapes.around("Close")).toEqual([])
    expect(shapes.around("Inspect")).toEqual([])
    expect(shapes.around("Unknown")).toEqual([])
  })
})

describe("the badges of a diagram", () => {
  test("roll the incidents inside a collapsed sub-process up onto it, keeping its running count", () => {
    const badges = DiagramBadges.of(RETURN, [
      statistic("Inspect", { active: 3 }),
      statistic("Weigh", { active: 1 }),
      statistic("ReadScale", { incidents: 1, incidentsInCalledInstances: 2 }),
      statistic("PayRefund", { incidents: 4 }),
    ])

    expect(badges).toEqual([
      statistic("Inspect", { active: 3, incidents: 1, incidentsInCalledInstances: 2 }),
      statistic("Weigh", { active: 1, incidents: 1, incidentsInCalledInstances: 2 }),
      statistic("ReadScale", { incidents: 1, incidentsInCalledInstances: 2 }),
      statistic("PayRefund", { incidents: 4 }),
    ])
  })

  test("appear on a collapsed sub-process the engine counts nothing at, and nowhere without counts", () => {
    const badges = DiagramBadges.of(RETURN, [
      statistic("Check", { incidents: 1 }),
      statistic("Close", {}),
    ])

    expect(badges).toEqual([
      statistic("Check", { incidents: 1 }),
      statistic("Inspect", { incidents: 1 }),
    ])
  })
})
