import { describe, expect, test } from "vitest"
import { StackFrames } from "../../src/host/panels/stack-frames.js"

const TRACE = [
  "org.operaton.bpm.engine.ProcessEngineException: boom",
  "\tat com.acme.credit.ScoringClient.score(ScoringClient.java:58)",
  "\tat com.acme.credit.CheckCreditDelegate$Inner.execute(CheckCreditDelegate.kt:31)",
  "\tat java.base/java.lang.Thread.run(Thread.java:1583)",
  "\tat org.springframework.aop.Proxy.invoke(Proxy.java:12)",
  "\tat Toplevel.main(Toplevel.java:3)",
  "\tat com.acme.Generated.call(Unknown Source)",
  "Caused by: java.net.ConnectException: Connection refused",
].join("\n")

describe("stack frames", () => {
  test("point from application frames to the source file and line", () => {
    const lines = TRACE.split("\n")
    expect(
      StackFrames.in(TRACE).map((frame) => ({
        linked: lines[frame.line]?.slice(frame.start, frame.end),
        sourceGlob: frame.sourceGlob,
        sourceLine: frame.sourceLine,
      })),
    ).toEqual([
      {
        linked: "ScoringClient.java:58",
        sourceGlob: "**/com/acme/credit/ScoringClient.java",
        sourceLine: 58,
      },
      {
        linked: "CheckCreditDelegate.kt:31",
        sourceGlob: "**/com/acme/credit/CheckCreditDelegate.kt",
        sourceLine: 31,
      },
      { linked: "Toplevel.java:3", sourceGlob: "**/Toplevel.java", sourceLine: 3 },
    ])
  })

  test("cover exactly the file and line of the frame", () => {
    const [first] = StackFrames.in(TRACE)
    const line = TRACE.split("\n")[1] ?? ""
    expect(line.slice(first?.start, first?.end)).toBe("ScoringClient.java:58")
  })

  test("skip platform frames and frames without a source", () => {
    expect(
      StackFrames.in("\tat java.util.List.of(List.java:1)\n\tat a.B.c(Unknown Source)"),
    ).toEqual([])
  })
})

describe("class mentions in a stack trace", () => {
  const trace = [
    "io.miragon.shop.payment.PaymentFailedException: Payment for order ORD-1 failed",
    "\tat io.miragon.shop.payment.ChargePaymentWorker.charge(ChargePaymentWorker.java:34)",
    "\tat io.miragon.shop.payment.Gateway$Retry.lambda$run$0(Gateway.java:12)",
    "\tat java.base/java.lang.Thread.run(Thread.java:1583)",
    "Caused by: io.miragon.shop.payment.CardExpiredException: Card ending 5736 expired",
    "Caused by: java.net.ConnectException: Connection refused",
    "\t... 7 more",
  ].join("\n")

  test("link the thrown classes and the classes of application frames", () => {
    const lines = trace.split("\n")
    expect(
      StackFrames.classesIn(trace).map((mention) => ({
        line: mention.line,
        linked: lines[mention.line]?.slice(mention.start, mention.end),
        className: mention.className,
      })),
    ).toEqual([
      {
        line: 0,
        linked: "io.miragon.shop.payment.PaymentFailedException",
        className: "io.miragon.shop.payment.PaymentFailedException",
      },
      {
        line: 1,
        linked: "io.miragon.shop.payment.ChargePaymentWorker",
        className: "io.miragon.shop.payment.ChargePaymentWorker",
      },
      {
        line: 2,
        linked: "io.miragon.shop.payment.Gateway$Retry",
        className: "io.miragon.shop.payment.Gateway$Retry",
      },
      {
        line: 4,
        linked: "io.miragon.shop.payment.CardExpiredException",
        className: "io.miragon.shop.payment.CardExpiredException",
      },
    ])
  })

  test("ignore prose that only looks like a class name", () => {
    expect(
      StackFrames.classesIn("Error: Carrier rejected parcel\n    at async Promise.all"),
    ).toEqual([])
  })
})
