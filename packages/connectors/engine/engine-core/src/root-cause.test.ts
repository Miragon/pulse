import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { rootCause, rootCauseLine } from "./root-cause.js"

const STACKTRACE = [
  "org.camunda.bpm.engine.ProcessEngineException: Unknown property used in expression: ${failBooking ? missingBean.run() : true}. Cause: Cannot resolve identifier 'missingBean'",
  "\tat org.camunda.bpm.engine.impl.el.JuelExpression.getValue(JuelExpression.java:93)",
  "Caused by: org.camunda.bpm.impl.juel.PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
  "\tat org.camunda.bpm.impl.juel.AstIdentifier.eval(AstIdentifier.java:83)",
  "\t... 42 more",
].join("\n")

describe("rootCause", () => {
  it('takes the last "Caused by:" line with the simple class name', () => {
    expect(rootCause(STACKTRACE)).toBe(
      "PropertyNotFoundException: Cannot resolve identifier 'missingBean'",
    )
  })

  it("takes the first non-blank line without a cause", () => {
    expect(rootCause("\n\n  java.lang.IllegalStateException: broken\n\tat x.y(Z.java:1)")).toBe(
      "IllegalStateException: broken",
    )
    expect(rootCause("Card declined\r\nsecond line")).toBe("Card declined")
  })

  it("keeps messages that only look like dotted names", () => {
    expect(rootCause("missingBean.run() failed")).toBe("missingBean.run() failed")
    expect(rootCause("see docs.camunda.org for help")).toBe("see docs.camunda.org for help")
    expect(rootCause("java.lang.NullPointerException")).toBe("NullPointerException")
  })

  it("is undefined for blank text", () => {
    expect(rootCause("")).toBeUndefined()
    expect(rootCause(" \n\t\n")).toBeUndefined()
  })

  it("shortens long lines to 300 characters with an ellipsis", () => {
    const cause = rootCause(`Caused by: ${"x".repeat(400)}`)
    expect(cause).toHaveLength(300)
    expect(cause?.endsWith("…")).toBe(true)
    expect(rootCause("y".repeat(300))).toBe("y".repeat(300))
  })

  it("is one line of at most 300 characters and the last cause wins (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), fc.string({ minLength: 1 }), (lines, last) => {
        const marker = `M${last.replace(/\s/g, "_")}`
        const text = [...lines, `Caused by: ${marker}`, ...lines.map((line) => `\t${line}`)]
        const cause = rootCause(text.join("\n"))
        expect(cause).toBeDefined()
        expect(cause!.length).toBeLessThanOrEqual(300)
        expect(cause).not.toMatch(/[\r\n]/)
        const later = lines
          .join("\n")
          .split(/\r\n|[\n\r]/)
          .some((line) => line.trim().startsWith("Caused by: "))
        if (!later) expect(marker.startsWith(cause!.replace(/…$/, ""))).toBe(true)
      }),
    )
  })
})

describe("rootCause details", () => {
  it("shortens only a leading class name and collapses inner whitespace", () => {
    expect(rootCause("failed in com.acme.Thing")).toBe("failed in com.acme.Thing")
    expect(rootCause("org.x.F bar")).toBe("F bar")
    expect(rootCause("a \t  b")).toBe("a b")
  })
})

describe("rootCauseLine", () => {
  it('points at the line of the last "Caused by:", if there is one', () => {
    expect(rootCauseLine("a\nCaused by: b\n  at x\nCaused by: c\n  at y")).toBe(3)
    expect(rootCauseLine(STACKTRACE)).toBe(2)
    expect(rootCauseLine("no cause here")).toBeUndefined()
    expect(rootCauseLine("")).toBeUndefined()
  })

  it("counts CRLF, LF and CR as one line break each and ignores indentation", () => {
    expect(rootCauseLine("a\r\nb\rc\n\t  Caused by: d")).toBe(3)
  })

  it("is the line rootCause reads its cause from (property)", () => {
    fc.assert(
      fc.property(fc.array(fc.string()), (lines) => {
        const text = lines.join("\n")
        const index = rootCauseLine(text)
        const all = text.split(/\r\n|[\n\r]/)
        if (index === undefined) {
          expect(all.some((line) => line.trim().startsWith("Caused by: "))).toBe(false)
        } else {
          const cause = all[index]?.trim().slice("Caused by: ".length) ?? ""
          expect(rootCause(text)).toBe(rootCause(cause) ?? "")
          expect(all.slice(index + 1).some((line) => line.trim().startsWith("Caused by: "))).toBe(
            false,
          )
        }
      }),
    )
  })
})
