import { describe, expect, it } from "vitest"
import { causeOf } from "./cause.js"

const STACKTRACE = [
  "org.cibseven.bpm.engine.ProcessEngineException: Card declined",
  "\tat com.example.order.ChargeDelegate.execute(ChargeDelegate.java:42)",
  "Caused by: com.example.payment.PaymentRefusedException: insufficient funds",
].join("\n")

describe("causeOf", () => {
  it("is the root cause of the text", () => {
    expect(causeOf(STACKTRACE, "Card declined")).toBe("PaymentRefusedException: insufficient funds")
    expect(causeOf("worker said no\nsecond line", undefined)).toBe("worker said no")
  })

  it("falls back without a text or without a line in it", () => {
    expect(causeOf(undefined, "the message")).toBe("the message")
    expect(causeOf(" \n\t", "the message")).toBe("the message")
    expect(causeOf("", undefined)).toBeUndefined()
  })
})
