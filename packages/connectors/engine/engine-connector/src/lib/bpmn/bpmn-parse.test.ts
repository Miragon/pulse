import { describe, expect, it } from "vitest"
import { bpmnActivityIds } from "./bpmn-parse.js"

describe("bpmnActivityIds", () => {
  it("lists tasks, gateways, events, sub-processes, and call activities", () => {
    const xml = `
      <bpmn:startEvent id="S" />
      <bpmn:userTask id="U1" name="Review" />
      <bpmn:serviceTask id="S1" />
      <bpmn:exclusiveGateway id="G1" />
      <bpmn:subProcess id="SP" />
      <bpmn:callActivity id="CA" />
      <bpmn:endEvent id="E" />
      <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="U1" />
      <bpmn:timerEventDefinition id="T1" />
      <bpmndi:BPMNShape id="U1_di" bpmnElement="U1" />
    `
    expect(bpmnActivityIds(xml)).toEqual(["S", "U1", "S1", "G1", "SP", "CA", "E"])
  })

  it("returns no ids on input without recognised elements", () => {
    expect(bpmnActivityIds("<bpmn:definitions />")).toEqual([])
    expect(bpmnActivityIds("")).toEqual([])
  })
})
