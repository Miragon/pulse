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

const PLAIN = `<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <process id="plain">
    <task id="Start" />
    <transaction id="Settle">
      <serviceTask id="Book" />
    </transaction>
    <subProcess>
      <task id="Orphan" />
    </subProcess>
    <subProcess id="Pack">
      <task id="Wrap" />
    </subProcess>
  </process>
  <bpmndi:BPMNDiagram id="Diagram_Plain">
    <bpmndi:BPMNPlane id="Plane_Plain" bpmnElement="plain">
      <bpmndi:BPMNShape id="Shape_Pack" bpmnElement="Pack" isExpanded="false" />
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`

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

    expect(shapes.around("ReadScale")).toStrictEqual(["Weigh", "Inspect"])
    expect(shapes.around("Check")).toStrictEqual(["Inspect"])
    expect(shapes.around("Empty")).toStrictEqual(["Inspect"])
    expect(shapes.around("WriteNote")).toStrictEqual(["Notes"])
  })

  test("leave out an expanded sub-process and what lies outside every sub-process", () => {
    const shapes = CollapsedShapes.of(RETURN)

    expect(shapes.around("PayRefund")).toStrictEqual([])
    expect(shapes.around("Close")).toStrictEqual([])
    expect(shapes.around("Inspect")).toStrictEqual([])
    expect(shapes.around("Unknown")).toStrictEqual([])
  })

  test("read the tags of a diagram without prefixes, a collapsed transaction among them", () => {
    const shapes = CollapsedShapes.of(PLAIN)

    expect(shapes.around("Book")).toStrictEqual(["Settle"])
    expect(shapes.around("Wrap")).toStrictEqual(["Pack"])
  })

  test("name no sub-process without an id, and none around an element outside every sub-process", () => {
    const shapes = CollapsedShapes.of(PLAIN)

    expect(shapes.around("Orphan")).toStrictEqual([])
    expect(shapes.around("Start")).toStrictEqual([])
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

    expect(badges).toStrictEqual([
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

    expect(badges).toStrictEqual([
      statistic("Check", { incidents: 1 }),
      statistic("Inspect", { incidents: 1 }),
    ])
  })
})
