import { describe, expect, it } from "vitest"
import { recordedBpmn } from "./recorded-bpmn.js"
import { textReplacer } from "./recorded-answer.js"

/**
 * A recorded diagram keeps what a page draws and loses what the engine runs: the extension
 * elements and attributes, the bodies of scripts, conditions, standard BPMN's expressions and
 * timers, the comments; its free text replaced, or kept where asked. Prefixes are the diagram's
 * own, a quoted `>` part of its tag, a CDATA section read to its own end.
 */

const DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<!-- exported by hand, ask carol@example.com -->
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="D" modeler:executionPlatform="Camunda Platform">
  <process id="p" name="Orders &gt; 1000" isExecutable="true" camunda:historyTimeToLive="P30D">
    <userTask id="Review" name="Review a &gt; b" camunda:assignee='alice' camunda:candidateGroups="finance">
      <documentation>Call Bob on +49 89 1234</documentation>
      <extensionElements>
        <camunda:inputOutput><camunda:inputParameter name="token">s3cr3t</camunda:inputParameter></camunda:inputOutput>
      </extensionElements>
      <incoming>Flow_1</incoming>
    </userTask>
    <scriptTask id="Calc" scriptFormat="javascript"><script>var key = "s3cr3t"</script></scriptTask>
    <sequenceFlow id="Flow_2" sourceRef="Calc" targetRef="End"><conditionExpression xsi:type="tFormalExpression">\${amount &gt; limit}</conditionExpression></sequenceFlow>
    <extensionElements/>
    <script/>
    <textAnnotation id="Note"><text>Owner: Dave</text></textAnnotation>
  </process>
</definitions>`

describe("recordedBpmn", () => {
  it("keeps what a page draws, without what the engine runs, its free text replaced", () => {
    const kept = recordedBpmn(DIAGRAM, textReplacer())
    // What was cut leaves its indentation behind, a line of blanks, which XML reads as nothing.
    const lines = kept.split("\n").filter((line) => line.trim() !== "")
    expect(lines.join("\n")).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="D">
  <process id="p" name="Orders &gt; 1000" isExecutable="true">
    <userTask id="Review" name="Review a &gt; b">
      <incoming>Flow_1</incoming>
    </userTask>
    <scriptTask id="Calc" scriptFormat="javascript"><script></script></scriptTask>
    <sequenceFlow id="Flow_2" sourceRef="Calc" targetRef="End"><conditionExpression xsi:type="tFormalExpression"></conditionExpression></sequenceFlow>
    <script/>
    <textAnnotation id="Note"><text>Text left out of the recording (1)</text></textAnnotation>
  </process>
</definitions>`)
    for (const word of ["alice", "finance", "Bob", "s3cr3t", "carol", "Dave", "amount", "P30D"]) {
      expect(kept, word).not.toContain(word)
    }
  })

  it("keeps the free text where asked, never what the engine runs", () => {
    const kept = recordedBpmn(DIAGRAM, null)
    expect(kept).toContain("<documentation>Call Bob on +49 89 1234</documentation>")
    expect(kept).toContain("<text>Owner: Dave</text>")
    for (const word of ["alice", "s3cr3t", "carol", "amount", "camunda:"]) {
      expect(kept.replace(/xmlns:camunda=/, ""), word).not.toContain(word)
    }
  })

  it("reads any prefix, BPMN's own named one too, and leaves an element of a longer name", () => {
    const xml =
      '<bpmn2:task id="T" camunda:class="com.acme.Secret" xml:lang="de">' +
      '<bpmn2:extensionElements foo="a/b"><zeebe:x/></bpmn2:extensionElements>' +
      "<bpmn2:textAnnotationish>kept</bpmn2:textAnnotationish>" +
      "<bpmn2:conditionExpressionList>kept</bpmn2:conditionExpressionList></bpmn2:task>"
    expect(recordedBpmn(xml, textReplacer())).toBe(
      '<bpmn2:task id="T" xml:lang="de">' +
        "<bpmn2:textAnnotationish>kept</bpmn2:textAnnotationish>" +
        "<bpmn2:conditionExpressionList>kept</bpmn2:conditionExpressionList></bpmn2:task>",
    )
  })

  it("empties what the engine evaluates in standard BPMN: people, timers, assignments", () => {
    const xml =
      '<bpmn:userTask id="u" name="Approve"><bpmn:potentialOwner><bpmn:resourceAssignmentExpression>' +
      "<bpmn:formalExpression>user(jane.doe), group(management)</bpmn:formalExpression>" +
      "</bpmn:resourceAssignmentExpression></bpmn:potentialOwner><bpmn:humanPerformer>" +
      "<bpmn:resourceAssignmentExpression><bpmn:formalExpression>${secretAssignee}" +
      "</bpmn:formalExpression></bpmn:resourceAssignmentExpression></bpmn:humanPerformer>" +
      '<bpmn:dataInputAssociation id="a"><bpmn:assignment><bpmn:from>${salary}</bpmn:from>' +
      "<bpmn:to>${copy}</bpmn:to></bpmn:assignment></bpmn:dataInputAssociation></bpmn:userTask>\n" +
      '<bpmn:boundaryEvent id="b"><bpmn:timerEventDefinition><bpmn:timeDate>${dueDateFromSecret}' +
      "</bpmn:timeDate></bpmn:timerEventDefinition></bpmn:boundaryEvent>" +
      "<timeCycle>R3/PT${secretCycle}</timeCycle><timeDuration>PT${secretWait}</timeDuration>" +
      "<loopCondition>${more}</loopCondition><activationCondition>${n}</activationCondition>" +
      "<expression>${hidden}</expression>"
    const kept = recordedBpmn(xml, null)
    for (const word of ["jane", "management", "secret", "Secret", "salary", "copy", "more", "${"]) {
      expect(kept, word).not.toContain(word)
    }
    expect(kept).toContain(
      "<bpmn:potentialOwner><bpmn:resourceAssignmentExpression><bpmn:formalExpression></bpmn:formalExpression>",
    )
    expect(kept).toContain("<bpmn:assignment><bpmn:from></bpmn:from><bpmn:to></bpmn:to>")
    expect(kept).toContain("<bpmn:timeDate></bpmn:timeDate>")
    expect(kept).toContain('<bpmn:userTask id="u" name="Approve">')
  })

  it("reads a CDATA section to its own end, a comment and a processing instruction too", () => {
    const xml =
      '<?xml version="1.0"?><process id="p">' +
      "<script><![CDATA[if (a < b) { x = \"</script><task id='leak'/>\" }]]></script>" +
      "<documentation><![CDATA[Call Bob]]></documentation>" +
      '<textAnnotation id="N"><text><![CDATA[Owner: Dave]]></text></textAnnotation>' +
      "<!-- <task id='commented'/> --><task id=\"T\" name='a \"&gt;\" b'/></process>"
    expect(recordedBpmn(xml, textReplacer())).toBe(
      '<?xml version="1.0"?><process id="p"><script></script>' +
        '<textAnnotation id="N"><text>Text left out of the recording (1)</text></textAnnotation>' +
        '<task id="T" name=\'a "&gt;" b\'/></process>',
    )
    expect(recordedBpmn(xml, null)).toContain("<documentation><![CDATA[Call Bob]]></documentation>")
  })

  it("keeps nothing after markup that never ends, nor of an element never closed", () => {
    expect(recordedBpmn('<process id="p"><task id="T"/><script><![CDATA[ x = 1', null)).toBe(
      '<process id="p"><task id="T"/><script>',
    )
    expect(recordedBpmn('<process id="p"><task name="x', null)).toBe('<process id="p">')
    expect(recordedBpmn("<process><documentation>Call Bob", textReplacer())).toBe("<process>")
    expect(recordedBpmn('<task id="A" camunda:x="1" junk/>', null)).toBe('<task id="A"/>')
  })

  it("reads in one pass, fast on markup that never ends and on many openers", () => {
    const started = performance.now()
    expect(recordedBpmn(`<process>${'<task name="x'.repeat(4000)}`, null)).toBe("<process>")
    expect(recordedBpmn(`<process>${"<!--".repeat(100_000)}`, null)).toBe("<process>")
    // Both take 3 ms alone, up to 30 times that while `pnpm test` runs every package's suite at
    // once; a lazy element regex scans from each opener to the end and takes 10 s, so 3 s still
    // tells the two apart.
    expect(performance.now() - started).toBeLessThan(3000)
  })
})
