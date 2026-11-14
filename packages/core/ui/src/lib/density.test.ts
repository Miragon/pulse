import { describe, expect, it } from "vitest"
import { DENSITY_CELL_PADDING, DENSITY_RADIUS, DENSITY_SPACING } from "./density.js"
import { cn } from "./utils.js"

/**
 * cn over the density keys. The class names are put together here, so Tailwind's scan of the kit's
 * sources finds none of them in this file and ships no utility a test alone names.
 */

const utility = (prefix: string, key: string) => `${prefix}-${key}`

describe("cn knows the density keys (tailwind-merge would keep both heights)", () => {
  it("lets a later height, minimum height, size, padding or gap win, a density key or Tailwind's", () => {
    const tailwind = { h: "8", "min-h": "12", size: "8", p: "4", gap: "6" }
    for (const key of Object.keys(DENSITY_SPACING)) {
      for (const [prefix, step] of Object.entries(tailwind)) {
        const own = utility(prefix, key)
        const theirs = utility(prefix, step)
        expect(cn(theirs, own)).toBe(own)
        expect(cn(own, theirs)).toBe(theirs)
      }
    }
  })

  it("keeps a minimum height beside a height, and one density key beside another axis", () => {
    const control = utility("min-h", "control")
    expect(cn(utility("h", "8"), control)).toBe(`h-8 ${control}`)
    const [gutter, row] = [utility("px", "gutter"), utility("py", "row")]
    expect(cn(gutter, row)).toBe(`${gutter} ${row}`)
  })

  it("keeps the cell's two axes apart, and a later padding of the same axis wins", () => {
    const [px, py] = Object.keys(DENSITY_CELL_PADDING).map((axis) => utility(axis, "cell"))
    expect(cn(px, py)).toBe(`${px} ${py}`)
    expect(cn(utility("px", "4"), px)).toBe(px)
    expect(cn(px, utility("px", "4"))).toBe("px-4")
    expect(cn(utility("py", "3"), py)).toBe(py)
    expect(cn(px, py, utility("p", "4"))).toBe("p-4")
  })

  it("lets a later radius win, the button's or Tailwind's", () => {
    for (const key of Object.keys(DENSITY_RADIUS)) {
      const own = utility("rounded", key)
      expect(cn("rounded-md", own)).toBe(own)
      expect(cn(own, "rounded-md")).toBe("rounded-md")
    }
  })
})
