import { describe, expect, it } from "vitest"
import { itemCommand } from "./next-text.js"
import { shellWord } from "./shell.js"

describe("shellWord", () => {
  it("quotes only what needs quoting", () => {
    expect(shellWord("order-process_2.v1")).toBe("order-process_2.v1")
    expect(shellWord("my task")).toBe("'my task'")
    expect(shellWord("it's")).toBe("'it'\\''s'")
  })
})

describe("itemCommand", () => {
  it("names the generated command that moves one wait state", () => {
    const at = { activityId: "a", executionId: "ex1", eventSubscriptionId: "s1" }
    expect(itemCommand({ ...at, kind: "message", eventName: "Paid now" })).toBe(
      "pulse execution trigger-event ex1 'Paid now'",
    )
    expect(itemCommand({ ...at, kind: "signal", eventName: "go" })).toBe(
      "pulse signal throw --name go --execution-id ex1",
    )
    expect(itemCommand({ ...at, kind: "message" })).toBe("pulse execution trigger-event ex1 ''")
    expect(itemCommand({ activityId: "r", kind: "other", executionId: "ex2" })).toBe(
      "pulse execution signal ex2",
    )
    expect(
      itemCommand({ activityId: "t", kind: "timer", jobId: "j", dueDate: "d", retries: 1 }),
    ).toBe("pulse job execute j")
    expect(itemCommand({ ...at, kind: "conditional" })).toBeUndefined()
  })
})
