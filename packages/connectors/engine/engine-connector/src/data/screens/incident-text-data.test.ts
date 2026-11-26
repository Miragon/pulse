import { describe, expect, it } from "vitest"
import { INCIDENT_TEXT_CAP, incidentTextOf } from "./incident-text-data.js"

const line = (n: number) => `\tat io.example.Frame${String(n)}.run(Frame.java:1)`

/** A stack trace of `count` lines with its cause on line `causeAt`. */
function trace(count: number, causeAt: number) {
  const lines = Array.from({ length: count }, (_, index) =>
    index === causeAt ? "Caused by: java.net.ConnectException: refused" : line(index),
  )
  return lines.join("\n")
}

describe("an incident's text in the feed", () => {
  it("carries a text under the cap as the engine gave it, with its cause and its line", () => {
    const text = trace(5, 2)
    expect(
      incidentTextOf("i1", {
        kind: "stacktrace",
        text,
        truncated: false,
        rootCause: "ConnectException: refused",
        rootCauseLine: 2,
      }),
    ).toEqual({
      incidentId: "i1",
      kind: "stacktrace",
      text,
      truncated: false,
      rootCause: "ConnectException: refused",
      rootCauseLine: 2,
    })
  })

  it("says the engine cut it off, and says so for an error message without a cause", () => {
    expect(incidentTextOf("i2", { kind: "errorMessage", text: "boom", truncated: true })).toEqual({
      incidentId: "i2",
      kind: "errorMessage",
      text: "boom",
      truncated: true,
      rootCause: null,
      rootCauseLine: null,
    })
  })

  it("cuts a text over the cap at a line's end and keeps a cause line inside the cut", () => {
    const text = trace(5000, 3)
    const read = incidentTextOf("i3", {
      kind: "stacktrace",
      text,
      truncated: false,
      rootCause: "ConnectException: refused",
      rootCauseLine: 3,
    })
    expect(text.length).toBeGreaterThan(INCIDENT_TEXT_CAP)
    expect(read.text.length).toBeLessThanOrEqual(INCIDENT_TEXT_CAP)
    expect(text.startsWith(`${read.text}\n`)).toBe(true)
    expect(read.truncated).toBe(true)
    expect(read.rootCauseLine).toBe(3)
  })

  it("leaves out a cause line beyond the cut, but keeps the cause", () => {
    const read = incidentTextOf("i4", {
      kind: "stacktrace",
      text: trace(5000, 4900),
      truncated: false,
      rootCause: "ConnectException: refused",
      rootCauseLine: 4900,
    })
    expect(read.rootCauseLine).toBeNull()
    expect(read.rootCause).toBe("ConnectException: refused")
  })

  it("cuts a single line over the cap at the cap", () => {
    const read = incidentTextOf("i5", {
      kind: "errorMessage",
      text: "x".repeat(INCIDENT_TEXT_CAP + 10),
      truncated: false,
      rootCauseLine: 0,
    })
    expect(read.text).toHaveLength(INCIDENT_TEXT_CAP)
    expect(read.rootCauseLine).toBe(0)
  })
})
