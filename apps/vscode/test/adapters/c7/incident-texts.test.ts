import { describe, expect, test } from "vitest"
import { IncidentTexts } from "../../../src/adapters/c7/mapping/incident-texts.js"

function rootCauseOf(text: string): string | undefined {
  return IncidentTexts.details("stacktrace", text, false).rootCause
}

function rootCauseLineOf(text: string): number | undefined {
  return IncidentTexts.details("errorMessage", text, false).rootCauseLine
}

describe("the root cause of incident details", () => {
  test('is the last "Caused by" line with the class shortened', () => {
    const trace = [
      "org.camunda.bpm.engine.ProcessEngineException: outer",
      "\tat a.b.C.run(C.java:1)",
      "Caused by: java.net.ConnectException: inner",
      "Caused by: java.net.SocketException: Connection refused",
    ].join("\n")
    expect(rootCauseOf(trace)).toBe("SocketException: Connection refused")
  })

  test("is the first line of a message without causes", () => {
    expect(rootCauseOf("\n  SMTP relay rejected recipient \n")).toBe(
      "SMTP relay rejected recipient",
    )
  })

  test("points at the line of the last cause, if there is one", () => {
    expect(rootCauseLineOf("a\nCaused by: b\n  at x\nCaused by: c\n  at y")).toBe(3)
    expect(rootCauseLineOf("no cause here")).toBeUndefined()
  })

  test("is undefined for blank text and cut at 300 characters", () => {
    expect(rootCauseOf("   ")).toBeUndefined()
    expect(rootCauseOf("x".repeat(400))?.length).toBe(300)
  })

  test("travels with the details it was read from", () => {
    expect(IncidentTexts.details("stacktrace", "a\nCaused by: x.Y: z", true)).toEqual({
      kind: "stacktrace",
      text: "a\nCaused by: x.Y: z",
      truncated: true,
      rootCause: "Y: z",
      rootCauseLine: 1,
    })
    expect(IncidentTexts.details("errorMessage", "", false)).toEqual({
      kind: "errorMessage",
      text: "",
      truncated: false,
    })
  })
})
