import { describe, expect, it } from "vitest"
import {
  bpmnActivityIds,
  bpmnCallActivityIds,
  bpmnProcessEndEventIds,
  bpmnUserTaskIds,
} from "./bpmn-parse.js"

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

describe("bpmnCallActivityIds", () => {
  it("lists the call activities alone, with or without a prefix", () => {
    const xml = `
      <bpmn:serviceTask id="S1" />
      <bpmn:callActivity id="CA" calledElement="check" />
      <callActivity id="CB"/>
      <bpmn:callActivityX id="NotOne" />
      <bpmndi:BPMNShape id="CA_di" bpmnElement="CA" />
    `
    expect(bpmnCallActivityIds(xml)).toEqual(["CA", "CB"])
  })

  it("returns no ids on a diagram without call activities", () => {
    expect(bpmnCallActivityIds('<bpmn:serviceTask id="S1" />')).toEqual([])
    expect(bpmnCallActivityIds("")).toEqual([])
  })
})

describe("bpmnUserTaskIds", () => {
  it("lists the user tasks of any prefix", () => {
    const xml =
      '<bpmn:process id="p"><bpmn:userTask id="review" name="Review"/><serviceTask id="charge"/>' +
      '<userTask id="approve"></userTask><bpmn:userTaskX id="NotOne"/></bpmn:process>'
    expect(bpmnUserTaskIds(xml)).toEqual(["review", "approve"])
  })
})

describe("bpmnProcessEndEventIds", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:collaboration id="c"><bpmn:participant id="pool" processRef="order"/></bpmn:collaboration>
  <bpmn:process id="order" isExecutable="true">
    <bpmn:startEvent id="start"/>
    <bpmn:endEvent id="done" name="Done"><bpmn:incoming>f1</bpmn:incoming></bpmn:endEvent>
    <bpmn:subProcess id="sub">
      <bpmn:endEvent id="subDone"/>
    </bpmn:subProcess>
    <bpmn:subProcess id="onError" triggeredByEvent="true">
      <bpmn:endEvent id="errorHandled"><bpmn:incoming>f2</bpmn:incoming></bpmn:endEvent>
    </bpmn:subProcess>
    <!-- <bpmn:endEvent id="commented"/> -->
    <bpmn:documentation><![CDATA[<bpmn:endEvent id="inText"/>]]></bpmn:documentation>
    <bpmn:endEvent id='rejected' name="a > b" />
  </bpmn:process>
  <bpmn:process id="other"><bpmn:endEvent id="otherDone"/></bpmn:process>
</bpmn:definitions>`

  it("lists the end events directly in the process, never a subprocess's or another process's", () => {
    expect(bpmnProcessEndEventIds(xml, "order")).toEqual(["done", "rejected"])
    expect(bpmnProcessEndEventIds(xml, "other")).toEqual(["otherDone"])
  })

  it("finds none for a process the diagram lacks, or a document that is no BPMN", () => {
    expect(bpmnProcessEndEventIds(xml, "missing")).toEqual([])
    expect(bpmnProcessEndEventIds("not xml", "order")).toEqual([])
    expect(bpmnProcessEndEventIds('<process id="order"><!-- open', "order")).toEqual([])
  })
})
