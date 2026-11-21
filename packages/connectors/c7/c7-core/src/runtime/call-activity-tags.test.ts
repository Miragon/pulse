import { describe, expect, it } from "vitest"
import { CALL_ACTIVITY_TAG, callActivityIdsOf } from "./call-activity-tags.js"

const diagram = (...tags: string[]) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">',
    '<bpmn:process id="Process_Order" isExecutable="true">',
    ...tags,
    "</bpmn:process>",
    "</bpmn:definitions>",
  ].join("\n")

const idsOf = (...tags: string[]) => {
  const ids = callActivityIdsOf(diagram(...tags))
  return ids === undefined ? undefined : [...ids]
}

describe("callActivityIdsOf", () => {
  it("reads the id of every call activity, whatever its prefix", () => {
    expect(
      idsOf(
        '<bpmn:callActivity id="Call_Prefixed" calledElement="invoice" />',
        '<callActivity id="Call_Plain" calledElement="${next}">',
        "</callActivity>",
        '<my-ns:callActivity id="Call_Dashed" />',
        '<my.ns:callActivity id="Call_Dotted" />',
        '<bpmnü:callActivity id="Call_Letters" />',
      ),
    ).toStrictEqual(["Call_Prefixed", "Call_Plain", "Call_Dashed", "Call_Dotted", "Call_Letters"])
  })

  it("reads an id quoted either way, spaced around its equals sign, after other attributes", () => {
    expect(
      idsOf(
        "<bpmn:callActivity id='Call_Single' />",
        '<bpmn:callActivity\n  name="Charge > 100"\n  id = "Call_Spaced"\n/>',
        '<bpmn:callActivity name=\'Call id="Wrong"\' id="Call_Named" />',
        '<bpmn:callActivity name="Call id=\'Wrong\'" id="Call_Quoted" />',
        '<bpmn:callActivity xml:id="Wrong" id="Call_Unprefixed" />',
      ),
    ).toStrictEqual(["Call_Single", "Call_Spaced", "Call_Named", "Call_Quoted", "Call_Unprefixed"])
  })

  it("reads a call activity whose value holds the other quote, and the call activities after it", () => {
    expect(
      idsOf(
        `<bpmn:callActivity id="Call_Inch" name='5" pipe' calledElement="pipe" />`,
        '<bpmn:serviceTask id="Task_Charge" name="Charge" />',
        `<bpmn:callActivity id='Call_Apostrophe' name="Ship's label > 5 kg" />`,
        '<bpmn:callActivity id="Call_After" calledElement="label" />',
      ),
    ).toStrictEqual(["Call_Inch", "Call_Apostrophe", "Call_After"])
  })

  it("counts a call activity in a comment, and no other element", () => {
    expect(
      idsOf(
        '<bpmn:serviceTask id="Task_Charge" name="callActivity" />',
        '<bpmn:callActivityX id="Not_A_Call" />',
        '<!-- <bpmn:callActivity id="Call_Commented" /> -->',
        "</bpmn:callActivity>",
      ),
    ).toStrictEqual(["Call_Commented"])
  })

  it("gives an empty set for a diagram without a call activity", () => {
    expect(idsOf('<bpmn:serviceTask id="Task_Charge" />')).toStrictEqual([])
  })

  it.each([
    ["no diagram", undefined],
    ["a call activity without an id", diagram('<bpmn:callActivity calledElement="invoice" />')],
    ["a call activity whose id is unquoted", diagram("<bpmn:callActivity id=Call_Bare />")],
    ["a call activity with a prefixed id alone", diagram('<bpmn:callActivity bpmn:id="Call" />')],
    ["an id that holds a reference", diagram('<bpmn:callActivity id="Call_&#65;" />')],
    [
      "one unreadable id beside readable ones",
      diagram('<bpmn:callActivity id="Call_Readable" />', "<bpmn:callActivity />"),
    ],
  ])("gives no set for %s", (_case, xml) => {
    expect(callActivityIdsOf(xml)).toBeUndefined()
  })
})

describe("CALL_ACTIVITY_TAG", () => {
  it("matches a start tag whole, a double-quoted > part of it", () => {
    const xml = diagram('<bpmn:callActivity id="Call" name="a > b">', "</bpmn:callActivity>")
    expect([...xml.matchAll(CALL_ACTIVITY_TAG)].map(([tag]) => tag)).toStrictEqual([
      '<bpmn:callActivity id="Call" name="a > b">',
    ])
  })

  it("matches a start tag whole, a single-quoted > and the other quote part of it", () => {
    const xml = diagram(
      `<bpmn:callActivity id="Call" name='a > 5" b'>`,
      "</bpmn:callActivity>",
      '<bpmn:callActivity id="Next" />',
    )
    expect([...xml.matchAll(CALL_ACTIVITY_TAG)].map(([tag]) => tag)).toStrictEqual([
      `<bpmn:callActivity id="Call" name='a > 5" b'>`,
      '<bpmn:callActivity id="Next" />',
    ])
  })
})
