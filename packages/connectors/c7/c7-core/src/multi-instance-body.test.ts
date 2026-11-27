import { describe, expect, it } from "vitest"
import {
  elementOfActivity,
  isMultiInstanceBody,
  multiInstanceBodyOf,
} from "./multi-instance-body.js"

describe("the multi-instance body rule", () => {
  it("reads the body of an activity as the activity it repeats", () => {
    expect(isMultiInstanceBody("Activity_Pack#multiInstanceBody")).toBe(true)
    expect(elementOfActivity("Activity_Pack#multiInstanceBody")).toBe("Activity_Pack")
  })

  it.each([
    ["an activity", "Activity_Pack"],
    ["an id that holds the suffix before its end", "Activity_Pack#multiInstanceBody:a2"],
    ["the suffix in another case", "Activity_Pack#MultiInstanceBody"],
    ["an empty id", ""],
  ])("keeps %s as it is", (_kind, activityId) => {
    expect(isMultiInstanceBody(activityId)).toBe(false)
    expect(elementOfActivity(activityId)).toBe(activityId)
  })

  it("strips the suffix once, at the end", () => {
    expect(elementOfActivity("Pack#multiInstanceBody#multiInstanceBody")).toBe(
      "Pack#multiInstanceBody",
    )
    expect(elementOfActivity("#multiInstanceBody")).toBe("")
  })

  it("names the body of an element as the engine does, which reads back as the element", () => {
    expect(multiInstanceBodyOf("Activity_Pack")).toBe("Activity_Pack#multiInstanceBody")
    expect(elementOfActivity(multiInstanceBodyOf("Activity_Pack"))).toBe("Activity_Pack")
    expect(isMultiInstanceBody(multiInstanceBodyOf("Activity_Pack"))).toBe(true)
  })
})
