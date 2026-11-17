import { describe, expect, test } from "vitest"
import { BpmnText } from "../../src/mapping/bpmn-text.js"

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
  ])("reads %s as %s, a receive task as no event", (elementId, kind) => {
    expect(BpmnText.catchKind(WAITS, elementId)).toBe(kind)
  })

  test("reads single quotes like double ones", () => {
    const xml = definitions(`<bpmn:callActivity id='Call' name='Ship "express"'>
      <bpmn:extensionElements>
        <zeebe:calledElement processId='label' bindingType='versionTag' versionTag='v1' />
      </bpmn:extensionElements>
    </bpmn:callActivity>
    <bpmn:intermediateCatchEvent id='Wait'><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>`)

    expect(BpmnText.callActivities(xml)).toStrictEqual([
      { elementId: "Call", processId: "label", binding: "versionTag", versionTag: "v1" },
    ])
    expect(BpmnText.containers(xml)).toStrictEqual([{ elementId: "Call", callsProcess: true }])
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
    ["&#x10FFFF;", String.fromCodePoint(0x10ffff)],
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

  test("reads a comment, a CDATA section and a processing instruction each to its own end", () => {
    const xml = definitions(`<?pulse <!-- ?>
    <bpmn:callActivity id="AfterInstruction" />
    <!-- <?pulse --> <![CDATA[ --> ]]>
    <bpmn:intermediateCatchEvent id="Wait"><bpmn:signalEventDefinition /></bpmn:intermediateCatchEvent>
    <?pulse <bpmn:intermediateCatchEvent id="Hidden"><bpmn:timerEventDefinition /> ?>`)

    expect(BpmnText.callActivities(xml).map((call) => call.elementId)).toEqual(["AfterInstruction"])
    expect(BpmnText.catchKind(xml, "Wait")).toBe("signal")
    expect(BpmnText.catchKind(xml, "Hidden")).toBeUndefined()
  })

  test("reads a quoted > or /> as part of the value, never as the end of the tag", () => {
    const xml = definitions(`<bpmn:intermediateCatchEvent id="Wait" name="a /> b > c">
      <bpmn:signalEventDefinition />
    </bpmn:intermediateCatchEvent>
    <bpmn:callActivity id="Call" name='x > y'>
      <bpmn:extensionElements><zeebe:calledElement processId="label" /></bpmn:extensionElements>
    </bpmn:callActivity>`)

    expect(BpmnText.catchKind(xml, "Wait")).toBe("signal")
    expect(BpmnText.callActivities(xml)).toStrictEqual([
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
    <bpmn:intermediateCatchEvent id="Wait">
      <bpmn:timerEventDefinition />
    </bpmn:intermediateCatchEvent
    >
    <bpmn:receiveTask id="After" />`)

    expect(BpmnText.callActivities(xml)).toStrictEqual([
      { elementId: "Spaced", processId: "label", binding: "latest" },
    ])
    expect(BpmnText.catchKind(xml, "Wait")).toBe("timer")
  })

  test("reads elements without a prefix, in a default namespace, like prefixed ones", () => {
    const xml = definitions(`<callActivity id="Call">
      <extensionElements>
        <calledElement xmlns="http://camunda.org/schema/zeebe/1.0" processId="label" />
      </extensionElements>
    </callActivity>
    <intermediateCatchEvent id="Timer"><timerEventDefinition /></intermediateCatchEvent>
    <boundaryEvent id="Signal" attachedToRef="Call"><signalEventDefinition /></boundaryEvent>`)

    expect(BpmnText.callActivities(xml)).toStrictEqual([
      { elementId: "Call", processId: "label", binding: "latest" },
    ])
    expect(BpmnText.catchKind(xml, "Timer")).toBe("timer")
    expect(BpmnText.catchKind(xml, "Signal")).toBe("signal")
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

    expect(BpmnText.containers(xml)).toStrictEqual([
      { elementId: "Activity_ShipOrder", callsProcess: false },
      { elementId: "Activity_PackOrder", callsProcess: false },
      { elementId: "Activity_OnCancel", callsProcess: false },
      { elementId: "Activity_Tools", callsProcess: false },
      { elementId: "Activity_Payment", callsProcess: false },
      { elementId: "Activity_Label", callsProcess: true },
    ])
    expect(BpmnText.callActivities(xml)).toStrictEqual([
      { elementId: "Activity_Label", binding: "latest" },
    ])
  })

  describe("a diagram whose element names run long", () => {
    const LONG = "p".repeat(48_000)

    function waits(call: string, called: string, caught: string): string {
      return definitions(`<${call}:callActivity id="Call">
      <bpmn:extensionElements><${called}:calledElement processId="ship" /></bpmn:extensionElements>
    </${call}:callActivity>
    <${caught}:intermediateCatchEvent id="Wait"><bpmn:timerEventDefinition /></${caught}:intermediateCatchEvent>`)
    }

    test("reads thousands of containers whose prefix runs to 980 characters at once", () => {
      const prefix = "p".repeat(980)
      const foreign = Array.from(
        { length: 3500 },
        (_, index) => `<${prefix}:subProcess id="Foreign_${index}" />`,
      ).join("")
      const xml = definitions(
        `<bpmn:startEvent id="Start"><bpmn:extensionElements>${foreign}</bpmn:extensionElements></bpmn:startEvent>`,
      )
      const started = Date.now()

      const containers = BpmnText.containers(xml)

      expect(Date.now() - started).toBeLessThan(1000)
      expect(containers).toHaveLength(3500)
      expect(containers.at(-1)).toStrictEqual({ elementId: "Foreign_3499", callsProcess: false })
    })

    test.each([
      ["a call activity", waits(LONG, "zeebe", "bpmn")],
      ["a called element", waits("bpmn", LONG, "bpmn")],
      ["a catch event", waits("bpmn", "zeebe", LONG)],
    ])("reads %s whose name runs to 48,000 characters at once", (_, xml) => {
      const started = Date.now()

      expect(BpmnText.containers(xml)).toStrictEqual([{ elementId: "Call", callsProcess: true }])
      expect(BpmnText.callActivities(xml)).toStrictEqual([
        { elementId: "Call", processId: "ship", binding: "latest" },
      ])
      expect(BpmnText.catchKind(xml, "Wait")).toBe("timer")
      expect(Date.now() - started).toBeLessThan(1000)
    })
  })

  describe("a diagram that hides unended markup in a processing instruction", () => {
    const READ = definitions(`<bpmn:subProcess id="Pack">
      <bpmn:callActivity id="Ship">
        <bpmn:extensionElements><zeebe:calledElement processId="ship" /></bpmn:extensionElements>
      </bpmn:callActivity>
    </bpmn:subProcess>
    <bpmn:intermediateCatchEvent id="Wait"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>`)

    test.each([
      ["comment openers", "<!--".repeat(100_000)],
      ["sub-process tags with an unpaired quote", `${"<subProcess ".repeat(32_000)}"`],
      ["call activities that never close", '<callActivity id="Hidden">'.repeat(64_000)],
      ["catch events that never close", '<receiveTask id="Hidden">'.repeat(64_000)],
    ])("reads one that hides %s at once, in under a second", (_, hidden) => {
      const xml = `${READ}\n<?pulse ${hidden} ?>`
      const started = Date.now()

      expect(BpmnText.containers(xml)).toStrictEqual([
        { elementId: "Pack", callsProcess: false },
        { elementId: "Ship", callsProcess: true },
      ])
      expect(BpmnText.callActivities(xml)).toStrictEqual([
        { elementId: "Ship", processId: "ship", binding: "latest" },
      ])
      expect(BpmnText.catchKind(xml, "Wait")).toBe("timer")
      expect(BpmnText.catchKind(xml, "Hidden")).toBeUndefined()
      expect(Date.now() - started).toBeLessThan(1000)
    })
  })
})
