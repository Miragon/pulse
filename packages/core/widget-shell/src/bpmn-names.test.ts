import { describe, expect, it } from "vitest"
import { bpmnProcessNameOf, parseBpmnNames, readBpmnNames } from "./bpmn-names.js"

const LEASING = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_1">
  <!-- <bpmn:userTask id="Task_Commented" name="Never shown" /> -->
  <bpmn:process id="miraveloLeasing" name="Bike Leasing" isExecutable="true">
    <bpmn:startEvent id="StartEvent_1" name="Application&#10;&#10; received" />
    <bpmn:userTask id="Activity_Decide" name='Decide on "Leasing &amp; Co"'>
      <bpmn:documentation><![CDATA[<bpmn:task id="Task_InCdata" name="Nope"/>]]></bpmn:documentation>
    </bpmn:userTask>
    <bpmn:exclusiveGateway id="Gateway_Amount" name="Amount &gt; 1000?" />
    <bpmn:serviceTask id="Activity_Unnamed" />
    <bpmn:serviceTask id="Activity_Blank" name="   " />
    <bpmn:endEvent id="EndEvent_Done" name="Done &#x2713;"/>
  </bpmn:process>
</bpmn:definitions>`

/** What the Camunda Modeler writes: a named pool around an unnamed process, names with references. */
const MODELER_COLLABORATION = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_2">
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_Leasing" name="Miravelo - Bike Leasing" processRef="miraveloLeasing" />
  </bpmn:collaboration>
  <bpmn:process id="miraveloLeasing" isExecutable="true">
    <bpmn:userTask id="Activity_Check" name="Rechnung&#10;prüfen" />
    <bpmn:userTask id="Activity_Approve" name="Prüfen &#38; Freigeben" />
    <bpmn:task id="Activity_Quote" name="&#34;Angebot&#34; &#60;neu&#62;" />
  </bpmn:process>
</bpmn:definitions>`

describe("parseBpmnNames", () => {
  it("reads the process name and every named element, entities decoded, space folded", () => {
    expect(parseBpmnNames(LEASING, "miraveloLeasing")).toEqual({
      name: "Bike Leasing",
      elements: {
        StartEvent_1: "Application received",
        Activity_Decide: 'Decide on "Leasing & Co"',
        Gateway_Amount: "Amount > 1000?",
        EndEvent_Done: "Done ✓",
      },
    })
  })

  it("names a Modeler collaboration's process by its pool, numeric references decoded", () => {
    expect(parseBpmnNames(MODELER_COLLABORATION, "miraveloLeasing")).toEqual({
      name: "Miravelo - Bike Leasing",
      elements: {
        Activity_Check: "Rechnung prüfen",
        Activity_Approve: "Prüfen & Freigeben",
        Activity_Quote: '"Angebot" <neu>',
      },
    })
  })

  it("takes the pool's name when the process has none, and the default namespace", () => {
    const xml = `<definitions>
      <collaboration id="Collab">
        <participant id="Pool" name="Invoice handling" processRef="invoice"/>
        <participant id="Pool_Other" name="Another pool" processRef="other"/>
      </collaboration>
      <process id="invoice"><task id="Task_A" name="Approve"/></process>
      <process id="other" name="Other process"/>
    </definitions>`
    // The pool is no element; another process's pool never names this one.
    expect(parseBpmnNames(xml, "invoice")).toEqual({
      name: "Invoice handling",
      elements: { Task_A: "Approve" },
    })
    // Another process of the same file keeps its own name.
    expect(parseBpmnNames(xml, "other").name).toBe("Other process")
  })

  it("prefers the process's own name over its pool's, in either order", () => {
    const poolFirst = `<definitions><participant processRef="p" name="Pool"/><process id="p" name="Own"/></definitions>`
    const processFirst = `<definitions><process id="p" name="Own"/><participant processRef="p" name="Pool"/></definitions>`
    expect(parseBpmnNames(poolFirst, "p").name).toBe("Own")
    expect(parseBpmnNames(processFirst, "p").name).toBe("Own")
    // A blank own name is no name: the pool names it.
    const blank = `<definitions><participant processRef="p" name="Pool"/><process id="p" name=" &#10; "/></definitions>`
    expect(parseBpmnNames(blank, "p").name).toBe("Pool")
  })

  it("yields no names for a document that is not BPMN, never an error", () => {
    expect(parseBpmnNames("not xml at all <<<", "x")).toEqual({ name: null, elements: {} })
    expect(parseBpmnNames("", "x")).toEqual({ name: null, elements: {} })
    // A character reference past Unicode stays as written instead of throwing.
    const odd = `<process id="p"><task id="T" name="a &#99999999; b &#x110000; &bogus;"/></process>`
    expect(parseBpmnNames(odd, "p").elements.T).toBe("a &#99999999; b &#x110000; &bogus;")
  })
})

describe("readBpmnNames — comments and CDATA are cut linearly (CodeQL js/polynomial-redos)", () => {
  const doc = (inner: string) =>
    `<definitions><process id="p" name="Rechnung">${inner}<task id="t" name="Prüfen"/></process></definitions>`

  it("skips comments and CDATA, also when they quote a tag", () => {
    const names = readBpmnNames(
      doc('<!-- <task id="x" name="Kommentar"/> --><![CDATA[<task id="y" name="Daten"/>]]>'),
    )
    expect(names.elements).toEqual({ t: "Prüfen" })
    expect(names.processes).toEqual({ p: "Rechnung" })
  })

  it("drops everything after an unterminated opener, so no opener survives", () => {
    expect(readBpmnNames(doc("<!-- never closed")).elements).toEqual({})
    expect(readBpmnNames(doc("<![CDATA[ never closed")).elements).toEqual({})
  })

  it("reads attributes with a linear tokenizer", () => {
    const many = Array.from({ length: 20_000 }, (_, i) => `a${i}="${i}"`).join(" ")
    const doc = (tag: string) => `<definitions><process id="p">${tag}</process></definitions>`
    const started = performance.now()
    // A run without `=` makes the tag malformed: no names, and still fast.
    expect(readBpmnNames(doc(`<task ${"A".repeat(100_000)} id="t" name="x"/>`)).elements).toEqual(
      {},
    )
    expect(readBpmnNames(doc(`<task ${many} id="t" name='Prüfen' other = "x"/>`)).elements).toEqual(
      {
        t: "Prüfen",
      },
    )
    expect(performance.now() - started).toBeLessThan(1000)
  })

  it("stays fast on many repeated openers", () => {
    const started = performance.now()
    expect(readBpmnNames(doc("<!--".repeat(100_000))).elements).toEqual({})
    expect(readBpmnNames(doc("<!-- x -->".repeat(50_000))).elements).toEqual({ t: "Prüfen" })
    expect(performance.now() - started).toBeLessThan(1000)
  })
})

describe("readBpmnNames", () => {
  it("names every process of the file by the same rule, for a caller without the key", () => {
    const xml = `<definitions>
      <collaboration id="Collab">
        <participant id="Pool_A" name="Pool A" processRef="a"/>
        <participant id="Pool_B" name="Pool B" processRef="b"/>
        <participant id="Pool_Blank" name="" processRef="c"/>
        <participant id="Pool_NoRef" name="Black box"/>
      </collaboration>
      <process id="a"><task id="Task_A" name="A task"/></process>
      <process id="b" name="Process B"/>
      <process id="c"/>
    </definitions>`
    const names = readBpmnNames(xml)
    expect(names).toEqual({
      processes: { a: "Pool A", b: "Process B" },
      elements: { Task_A: "A task" },
    })
    expect(bpmnProcessNameOf(names, "a")).toBe("Pool A")
    expect(bpmnProcessNameOf(names, "c")).toBeNull()
    // A key such as `constructor` is no inherited lookup.
    expect(bpmnProcessNameOf(names, "constructor")).toBeNull()
  })
})
