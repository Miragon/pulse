import { describe, expect, test } from "vitest"
import { IncidentTexts } from "../../src/mapping/incident-texts.js"

describe("the details of an incident", () => {
  test("name the last cause of a stack trace and its line", () => {
    const text =
      "java.lang.IllegalStateException: failed\n\tat a.B(B.java:1)\nCaused by: java.net.ConnectException: down\n\tat c.D(D.java:2)"

    expect(IncidentTexts.details(text)).toEqual({
      kind: "errorMessage",
      text,
      truncated: false,
      rootCause: "ConnectException: down",
      rootCauseLine: 2,
    })
  })

  test("take a plain message as its own cause, on no line of its own", () => {
    expect(IncidentTexts.details("\n  no card on file  ")).toEqual({
      kind: "errorMessage",
      text: "\n  no card on file  ",
      truncated: false,
      rootCause: "no card on file",
    })
  })

  test("name no cause for an empty message", () => {
    expect(IncidentTexts.details(" \n ")).toEqual({
      kind: "errorMessage",
      text: " \n ",
      truncated: false,
    })
  })
})
