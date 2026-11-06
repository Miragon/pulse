import { describe, expect, test } from "vitest"
import { BpmnText } from "../../../src/adapters/c8/mapping/bpmn-text.js"

const NAMESPACES = [
  'xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"',
  'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
  'xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"',
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
  'xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"',
  'xmlns:other="http://example.com/other"',
].join(" ")

function definitions(process: string, diagram = ""): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions ${NAMESPACES} id="Definitions_Test" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="test" isExecutable="true">
    ${process}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_Test">
    <bpmndi:BPMNPlane id="Plane_Test" bpmnElement="test">${diagram}</bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`
}

function calledWith(attributes: string): string {
  return definitions(`<bpmn:callActivity id="Call">
      <bpmn:extensionElements>
        <zeebe:calledElement processId="label" bindingType="versionTag" ${attributes} />
      </bpmn:extensionElements>
    </bpmn:callActivity>`)
}

describe("the BPMN text reader", () => {
  const WAITS = definitions(`<bpmn:adHocSubProcess id="Tools">
      <bpmn:receiveTask id="Receive" messageRef="Message_Reply" />
    </bpmn:adHocSubProcess>
    <bpmn:intermediateCatchEvent id="Timer" name="One hour later">
      <bpmn:timerEventDefinition id="TimerEventDefinition_Timer">
        <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="Signal">
      <bpmn:signalEventDefinition id="SignalEventDefinition_Signal" signalRef="Signal_Stop" />
    </bpmn:intermediateCatchEvent>
    <bpmn:boundaryEvent id="Deadline" attachedToRef="Tools">
      <bpmn:timerEventDefinition id="TimerEventDefinition_Deadline" />
    </bpmn:boundaryEvent>
    <bpmn:intermediateCatchEvent id="Link">
      <bpmn:linkEventDefinition id="LinkEventDefinition_Link" name="Back" />
    </bpmn:intermediateCatchEvent>`)

  test.each([
    ["Receive", undefined],
    ["Timer", "timer"],
    ["Signal", "signal"],
    ["Deadline", "timer"],
    ["Link", undefined],
    ["Unknown", undefined],
  ])("reads %s as %s, a self-closing receive task ending at its own tag", (elementId, kind) => {
    expect(BpmnText.catchKind(WAITS, elementId)).toBe(kind)
  })

  test("reads single quotes like double ones", () => {
    const xml = definitions(`<bpmn:callActivity id='Call' name='Ship "express"'>
      <bpmn:extensionElements>
        <zeebe:calledElement processId='label' bindingType='versionTag' versionTag='v1' />
      </bpmn:extensionElements>
    </bpmn:callActivity>
    <bpmn:intermediateCatchEvent id='Wait'><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>`)

    expect(BpmnText.callActivities(xml)).toEqual([
      { elementId: "Call", processId: "label", binding: "versionTag", versionTag: "v1" },
    ])
    expect(BpmnText.containers(xml)).toEqual([{ elementId: "Call", callsProcess: true }])
    expect(BpmnText.catchKind(xml, "Wait")).toBe("timer")
  })

  test.each([["R&amp;D"], ["R&#38;D"], ["R&#x26;D"]])(
    "decodes %s to R&D before it compares a version tag",
    (written) => {
      expect(BpmnText.callActivities(calledWith(`versionTag="${written}"`))[0]?.versionTag).toBe(
        "R&D",
      )
    },
  )

  test.each([
    ["&lt;&gt;&quot;&apos;&amp;", `<>"'&`],
    ["&#x10400;", String.fromCodePoint(0x10400)],
    ["&amp;#38;", "&#38;"],
    ["&nbsp; &#x110000; &#X41; &#;", "&nbsp; &#x110000; &#X41; &#;"],
    ["a\r\n\tb&#10;c", "a  b\nc"],
  ])("reads the attribute value %j as %j", (written, read) => {
    expect(BpmnText.callActivities(calledWith(`versionTag="${written}"`))[0]?.versionTag).toBe(read)
  })

  test("compares an id only after decoding it", () => {
    const xml = definitions(
      `<bpmn:intermediateCatchEvent id="Wait&#45;1"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>`,
    )

    expect(BpmnText.catchKind(xml, "Wait-1")).toBe("timer")
  })

  test("skips commented-out elements and markup inside CDATA", () => {
    const xml = definitions(`<!-- <bpmn:callActivity id="Old" /> -->
    <!--
      <bpmn:intermediateCatchEvent id="Gone"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
    -->
    <bpmn:serviceTask id="Task">
      <bpmn:documentation><![CDATA[Calls <bpmn:callActivity id="InDocs"> in <bpmn:subProcess id="DocSub">]]></bpmn:documentation>
    </bpmn:serviceTask>
    <bpmn:intermediateCatchEvent id="Wait">
      <bpmn:documentation><![CDATA[</bpmn:intermediateCatchEvent> <!-- ]]></bpmn:documentation>
      <bpmn:timerEventDefinition>
        <bpmn:timeDuration xsi:type="bpmn:tFormalExpression"><![CDATA[PT5M]]></bpmn:timeDuration>
      </bpmn:timerEventDefinition>
    </bpmn:intermediateCatchEvent>
    <bpmn:callActivity id="Real" />`)

    expect(BpmnText.callActivities(xml).map((call) => call.elementId)).toEqual(["Real"])
    expect(BpmnText.containers(xml).map((container) => container.elementId)).toEqual(["Real"])
    expect(BpmnText.catchKind(xml, "Gone")).toBeUndefined()
    expect(BpmnText.catchKind(xml, "Wait")).toBe("timer")
  })

  test("leaves no comment behind that the removal of another one put together", () => {
    const xml = definitions(`<!<!-- one -->-- <bpmn:intermediateCatchEvent id="Hidden">
      <bpmn:timerEventDefinition />
    </bpmn:intermediateCatchEvent> -->
    <bpmn:intermediateCatchEvent id="Wait"><bpmn:signalEventDefinition /></bpmn:intermediateCatchEvent>`)

    expect(BpmnText.catchKind(xml, "Hidden")).toBeUndefined()
    expect(BpmnText.catchKind(xml, "Wait")).toBe("signal")
  })

  test("reads a quoted > or /> as part of the value, never as the end of the tag", () => {
    const xml = definitions(`<bpmn:intermediateCatchEvent id="Wait" name="a /> b > c">
      <bpmn:signalEventDefinition />
    </bpmn:intermediateCatchEvent>
    <bpmn:callActivity id="Call" name='x > y'>
      <bpmn:extensionElements><zeebe:calledElement processId="label" /></bpmn:extensionElements>
    </bpmn:callActivity>`)

    expect(BpmnText.catchKind(xml, "Wait")).toBe("signal")
    expect(BpmnText.callActivities(xml)).toEqual([
      { elementId: "Call", processId: "label", binding: "latest" },
    ])
  })

  test("takes an attribute only by its own name, never from inside another value", () => {
    const xml = definitions(`<bpmn:intermediateCatchEvent name='id="Wait"' id="Real">
      <bpmn:signalEventDefinition />
    </bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent other:id="Prefixed" id="Plain">
      <bpmn:timerEventDefinition />
    </bpmn:intermediateCatchEvent>`)

    expect(BpmnText.catchKind(xml, "Wait")).toBeUndefined()
    expect(BpmnText.catchKind(xml, "Real")).toBe("signal")
    expect(BpmnText.catchKind(xml, "Prefixed")).toBeUndefined()
    expect(BpmnText.catchKind(xml, "Plain")).toBe("timer")
  })

  test("allows white space around = and before the end of a closing tag", () => {
    const xml = definitions(`<bpmn:callActivity
        id = "Spaced"
        name="Ship">
      <bpmn:extensionElements>
        <zeebe:calledElement processId = 'label' />
      </bpmn:extensionElements>
    </bpmn:callActivity >
    <bpmn:receiveTask id="After" />`)

    expect(BpmnText.callActivities(xml)).toEqual([
      { elementId: "Spaced", processId: "label", binding: "latest" },
    ])
  })

  test("names every container of the diagram with an id, and which of them calls a process", () => {
    const xml = definitions(
      `<bpmn:subProcess id="Activity_ShipOrder">
      <bpmn:subProcess id="Activity_PackOrder">
        <bpmn:serviceTask id="Activity_Pack" />
      </bpmn:subProcess>
      <bpmn:subProcess id="Activity_OnCancel" triggeredByEvent="true">
        <bpmn:startEvent id="Event_Cancel" />
      </bpmn:subProcess>
    </bpmn:subProcess>
    <bpmn:adHocSubProcess id="Activity_Tools" />
    <transaction id="Activity_Payment"></transaction>
    <bpmn:callActivity id="Activity_Label" />
    <bpmn:subProcess name="Without an id" />
    <bpmn:callActivity name="Without an id" />`,
      `<bpmndi:BPMNShape id="Shape_PackOrder" bpmnElement="Activity_PackOrder" isExpanded="true" />`,
    )

    expect(BpmnText.containers(xml)).toEqual([
      { elementId: "Activity_ShipOrder", callsProcess: false },
      { elementId: "Activity_PackOrder", callsProcess: false },
      { elementId: "Activity_OnCancel", callsProcess: false },
      { elementId: "Activity_Tools", callsProcess: false },
      { elementId: "Activity_Payment", callsProcess: false },
      { elementId: "Activity_Label", callsProcess: true },
    ])
    expect(BpmnText.callActivities(xml)).toEqual([
      { elementId: "Activity_Label", binding: "latest" },
    ])
  })
})
