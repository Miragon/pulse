import { describe, expect, it } from "vitest"
import { MICRO_LABEL, TYPE_FLOOR_PX, TYPE_SCALE, TYPE_STEPS } from "./typography.js"
import { cn } from "./utils.js"

describe("the type scale (CI §4)", () => {
  it("has five steps, each its own self-named utility", () => {
    expect(TYPE_STEPS).toEqual(["title", "section", "body", "dense", "small"])
    expect(TYPE_SCALE).toEqual({
      title: "text-title",
      section: "text-section",
      body: "text-body",
      dense: "text-dense",
      small: "text-small",
    })
  })

  it("puts the floor at the CI's smallest size and micro-labels on it, in normal case", () => {
    expect(TYPE_FLOOR_PX).toBe(13)
    expect(MICRO_LABEL).toBe("text-small font-semibold")
    expect(MICRO_LABEL).not.toMatch(/uppercase|text-xs|text-\[/)
  })
})

describe("cn knows the type scale (tailwind-merge would drop it as a colour)", () => {
  it("keeps a scale size next to a text colour, in either order", () => {
    for (const size of Object.values(TYPE_SCALE)) {
      expect(cn(size, "text-muted-foreground")).toBe(`${size} text-muted-foreground`)
      expect(cn("text-danger-ink", size)).toBe(`text-danger-ink ${size}`)
    }
  })

  it("lets a later size win over an earlier one, scale or Tailwind", () => {
    expect(cn("text-sm", "text-small")).toBe("text-small")
    expect(cn("text-small", "text-xs")).toBe("text-xs")
    expect(cn("text-dense", "text-title")).toBe("text-title")
    expect(cn("md:text-sm", "md:text-dense")).toBe("md:text-dense")
  })

  it("keeps a leading set after the size (a size resets the line height before it)", () => {
    expect(cn("text-small", "leading-4")).toBe("text-small leading-4")
    expect(cn(MICRO_LABEL, "text-muted-foreground")).toBe(
      "text-small font-semibold text-muted-foreground",
    )
  })
})
