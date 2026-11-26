import { describe, expect, test } from "vitest"
import { CallActivities } from "../../src/builder/index.js"

describe("whether a diagram has a call activity", () => {
  test("is found by the element, any prefix, its id quoted either way or missing", () => {
    expect(
      CallActivities.found(`<bpmn:definitions><bpmn:process id="dispatch">
        <bpmn:callActivity id="Call_Label" calledElement="label">
          <bpmn:incoming>Flow_1</bpmn:incoming>
        </bpmn:callActivity>
      </bpmn:process></bpmn:definitions>`),
    ).toBe(true)
    expect(
      CallActivities.found(`<process><callActivity id='Call_B' calledElement="b"/></process>`),
    ).toBe(true)
    expect(CallActivities.found('<process><callActivity id = "Call_C" /></process>')).toBe(true)
    expect(CallActivities.found('<process><callActivity calledElement="x"></process>')).toBe(true)
  })

  test("is not found in a closing tag, a comment, another element's id or text that is no diagram", () => {
    expect(
      CallActivities.found(`<process><!-- <callActivity id="Commented" /> -->
        <serviceTask id="Task_callActivity" /></callActivity></process>`),
    ).toBe(false)
    expect(CallActivities.found('<process id="p"><task id="t" /></process>')).toBe(false)
    expect(CallActivities.found("")).toBe(false)
  })

  test("is unknown in a text too long to read", () => {
    const call = '<process><callActivity id="Call_A" calledElement="a"/></process>'
    const long = `<definitions><documentation>${"x".repeat(4 * 1024 * 1024)}</documentation>${call}</definitions>`

    expect(CallActivities.found(long)).toBeUndefined()
    expect(CallActivities.found(call)).toBe(true)
  })
})
