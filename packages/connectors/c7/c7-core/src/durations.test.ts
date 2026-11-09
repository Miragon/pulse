import { describe, expect, it } from "vitest"
import { formatDuration } from "./durations.js"

describe("formatDuration", () => {
  it.each([
    [1500, "1500ms"],
    [1000, "1s"],
    [90_000, "90s"],
    [120_000, "2m"],
    [300_000, "5m"],
    [3_600_000, "1h"],
    [5_400_000, "90m"],
  ])("prints %i ms as %s", (ms, text) => {
    expect(formatDuration(ms)).toBe(text)
  })
})
