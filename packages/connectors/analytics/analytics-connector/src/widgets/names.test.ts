import { describe, expect, it } from "vitest"
import { translator } from "../messages/use-t.js"
import { activityTypeKey, activityTypeLabel } from "./names.js"

describe("activity types in words", () => {
  it.each([
    ["serviceTask", "aActivityType.serviceTask"],
    ["callActivity", "aActivityType.callActivity"],
    ["exclusiveGateway", "aActivityType.exclusiveGateway"],
    ["startEvent", "aActivityType.startEvent"],
    ["startTimerEvent", "aActivityType.startEvent"],
    ["messageStartEvent", "aActivityType.startEvent"],
    ["noneEndEvent", "aActivityType.endEvent"],
    ["errorEndEvent", "aActivityType.endEvent"],
    ["endEvent", "aActivityType.endEvent"],
    ["boundaryError", "aActivityType.boundaryEvent"],
    ["boundaryTimer", "aActivityType.boundaryEvent"],
    ["intermediateTimer", "aActivityType.intermediateEvent"],
    ["intermediateMessageThrowEvent", "aActivityType.intermediateEvent"],
  ])("%s reads as %s", (type, key) => {
    expect(activityTypeKey(type)).toBe(key)
  })

  it("leaves a type it does not know as the engine wrote it", () => {
    expect(activityTypeKey("multiInstanceBody")).toBeNull()
    expect(activityTypeKey("")).toBeNull()
    const t = (key: string) => translator("de", key)
    expect(activityTypeLabel(t, "multiInstanceBody")).toBe("multiInstanceBody")
    expect(activityTypeLabel(t, "userTask")).toBe("User-Task")
    expect(activityTypeLabel((key) => translator("en", key), "noneEndEvent")).toBe("End event")
  })
})
