import fc from "fast-check"
import { describe, expect, test } from "vitest"
import { RootCauses } from "../src/index.js"

const STACKTRACE = [
  "org.camunda.bpm.engine.ProcessEngineException: Unknown property used in expression: ${failBooking ? missingBean.run() : true}. Cause: Cannot resolve identifier 'missingBean'",
  "\tat org.camunda.bpm.engine.impl.el.JuelExpression.getValue(JuelExpression.java:93)",
  "Caused by: org.camunda.bpm.impl.juel.PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
  "\tat org.camunda.bpm.impl.juel.AstIdentifier.eval(AstIdentifier.java:83)",
  "\t... 42 more",
].join("\n")

describe("RootCauses.of", () => {
  test('takes the last "Caused by:" line with the simple class name', () => {
    expect(RootCauses.of(STACKTRACE)).toBe(
      "PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
    )
    expect(RootCauses.of("x\nCaused by: a.B: first\n\tat y\nCaused by: c.D: last\n\tat z")).toBe(
      "D: last",
    )
  })

  test("takes the first non-blank line without a cause", () => {
    expect(RootCauses.of("\n\n  java.lang.IllegalStateException: broken\n\tat x.y(Z.java:1)")).toBe(
      "IllegalStateException: broken",
    )
    expect(RootCauses.of("Card declined\r\nsecond line")).toBe("Card declined")
  })

  test("keeps messages that only look like dotted names", () => {
    expect(RootCauses.of("missingBean.run() failed")).toBe("missingBean.run() failed")
    expect(RootCauses.of("see docs.camunda.org for help")).toBe("see docs.camunda.org for help")
    expect(RootCauses.of("java.lang.NullPointerException")).toBe("NullPointerException")
  })

  test("is undefined for blank text", () => {
    expect(RootCauses.of("")).toBeUndefined()
    expect(RootCauses.of(" \n\t\n")).toBeUndefined()
  })

  test("shortens long lines to 300 characters with an ellipsis", () => {
    const cause = RootCauses.of(`Caused by: ${"x".repeat(400)}`)
    expect(cause).toHaveLength(300)
    expect(cause?.endsWith("…")).toBe(true)
    expect(RootCauses.of("y".repeat(300))).toBe("y".repeat(300))
  })

  test("is one line of at most 300 characters and the last cause wins (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), fc.string({ minLength: 1 }), (lines, last) => {
        const marker = `M${last.replace(/\s/g, "_")}`
        const text = [...lines, `Caused by: ${marker}`, ...lines.map((line) => `\t${line}`)]
        const cause = RootCauses.of(text.join("\n"))
        expect(cause).toBeDefined()
        expect(cause!.length).toBeLessThanOrEqual(300)
        expect(cause).not.toMatch(/[\r\n]/)
        const later = lines
          .join("\n")
          .split(/\r\n|[\n\r]/)
          .some((line) => line.trim().startsWith("Caused by: "))
        if (!later) {
          expect(marker.startsWith(cause!.replace(/…$/, ""))).toBe(true)
        }
      }),
    )
  })
})

describe("RootCauses.of in detail", () => {
  test("shortens only a leading class name and collapses inner whitespace", () => {
    expect(RootCauses.of("failed in com.acme.Thing")).toBe("failed in com.acme.Thing")
    expect(RootCauses.of("org.x.F bar")).toBe("F bar")
    expect(RootCauses.of("a \t  b")).toBe("a b")
  })

  test('drops the blanks between "Caused by:" and its cause', () => {
    expect(RootCauses.of("Caused by:   spaced out")).toBe("spaced out")
  })
})

describe("RootCauses.lineOf", () => {
  test('points at the line of the last "Caused by:", if there is one', () => {
    expect(RootCauses.lineOf("a\nCaused by: b\n  at x\nCaused by: c\n  at y")).toBe(3)
    expect(RootCauses.lineOf(STACKTRACE)).toBe(2)
    expect(RootCauses.lineOf("no cause here")).toBeUndefined()
    expect(RootCauses.lineOf("")).toBeUndefined()
  })

  test("counts CRLF, LF and CR as one line break each and ignores indentation", () => {
    expect(RootCauses.lineOf("a\r\nb\rc\n\t  Caused by: d")).toBe(3)
  })

  test("is the line RootCauses.of reads its cause from (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (lines) => {
        const text = lines.join("\n")
        const index = RootCauses.lineOf(text)
        const all = text.split(/\r\n|[\n\r]/)
        if (index === undefined) {
          expect(all.some((line) => line.trim().startsWith("Caused by: "))).toBe(false)
        } else {
          const cause = all[index]?.trim().slice("Caused by: ".length) ?? ""
          expect(RootCauses.of(text)).toBe(RootCauses.of(cause) ?? "")
          expect(all.slice(index + 1).some((line) => line.trim().startsWith("Caused by: "))).toBe(
            false,
          )
        }
      }),
    )
  })
})
