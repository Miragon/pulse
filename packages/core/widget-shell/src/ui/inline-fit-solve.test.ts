import { describe, expect, it } from "vitest"
import { solveInlineFit, type FitSlot } from "./inline-fit-solve.js"

/** Sizes measured on the playground views at 760 px (#396). */

function list(id: string, count: number, height: number, top = 0, order = 0): FitSlot {
  return {
    id,
    order,
    bottoms: Array.from({ length: count }, (_, i) => top + (i + 1) * height),
    frozen: false,
  }
}

function view(budget: number, chrome: number, count: number, height: number) {
  return { budget, content: chrome + count * height, slots: [list("rows", count, height, chrome)] }
}

describe("solveInlineFit: one list", () => {
  it("leaves a view that fits as it is", () => {
    expect(solveInlineFit(view(600, 342, 2, 66))).toEqual({ cuts: {}, fits: true })
    expect(solveInlineFit(view(600, 400, 2, 100))).toEqual({ cuts: {}, fits: true })
  })

  it("keeps the rows that fit: engine-wide instances, scoped instances, a 600 px budget", () => {
    // 360 px chrome and 66 px rows (engine-wide instances after the density fix).
    expect(solveInlineFit(view(600, 360, 10, 66))).toEqual({ cuts: { rows: 3 }, fits: true })
    // 360 px chrome and 57 px rows (scoped instances).
    expect(solveInlineFit(view(600, 360, 10, 57))).toEqual({ cuts: { rows: 4 }, fits: true })
  })

  it("goes below 3 rows only where that makes the view fit: the job panel", () => {
    // 408 px chrome and 87 px rows: 3 rows are 669 px, 2 are 582.
    expect(solveInlineFit(view(600, 408, 10, 87))).toEqual({ cuts: { rows: 2 }, fits: true })
    expect(solveInlineFit(view(600, 500, 10, 87))).toEqual({ cuts: { rows: 1 }, fits: true })
  })

  it("keeps 3 rows when even 1 does not fit: the view then scrolls inside the budget", () => {
    // The analytics dashboard: about 1000 px around its activity table.
    expect(solveInlineFit(view(600, 1000, 7, 66))).toEqual({ cuts: { rows: 3 }, fits: false })
  })

  it("fits more rows into a larger budget", () => {
    expect(solveInlineFit(view(800, 360, 10, 66)).cuts).toEqual({ rows: 6 })
    expect(solveInlineFit(view(800, 360, 10, 57)).cuts).toEqual({ rows: 7 })
    expect(solveInlineFit(view(800, 408, 10, 87)).cuts).toEqual({ rows: 4 })
  })

  it("rounds a fractional content height up: 600.4 px is over a 600 px budget", () => {
    const slot = list("rows", 4, 50, 400)
    expect(solveInlineFit({ budget: 600, content: 600, slots: [slot] }).cuts).toEqual({})
    expect(solveInlineFit({ budget: 600, content: 600.4, slots: [slot] }).cuts).toEqual({ rows: 3 })
  })

  it("never cuts a list the user revealed rows of", () => {
    const frozen = { ...list("rows", 10, 66, 360), frozen: true }
    expect(solveInlineFit({ budget: 600, content: 1020, slots: [frozen] })).toEqual({
      cuts: {},
      fits: false,
    })
  })

  it("ignores lists that show no rows (hidden, empty)", () => {
    const hidden: FitSlot = { id: "hidden", order: 1, bottoms: [], frozen: false }
    expect(solveInlineFit({ budget: 600, content: 700, slots: [hidden] })).toEqual({
      cuts: {},
      fits: false,
    })
  })

  it("lets a short list give a row only where that makes the view fit, and never its last", () => {
    // 2 rows, 52 px over: one goes.
    expect(solveInlineFit(view(600, 520, 2, 66))).toEqual({ cuts: { rows: 1 }, fits: true })
    // 92 px over: even 1 row does not fit, so both stay.
    expect(solveInlineFit(view(600, 560, 2, 66))).toEqual({ cuts: {}, fits: false })
  })
})

describe("solveInlineFit: several lists", () => {
  const twoLists = (budget: number, over: number) => {
    const first = list("first", 6, 50, 200, 0)
    const second = list("second", 4, 50, 600, 1)
    return { budget, content: budget + over, slots: [first, second] }
  }

  it("takes rows from the list showing the most first", () => {
    // 6 and 4 rows: the first gives two, then both are at 4 and the later one gives.
    expect(solveInlineFit(twoLists(600, 150)).cuts).toEqual({ first: 4, second: 3 })
  })

  it("on a tie, the later list gives first", () => {
    const first = list("first", 4, 50, 200, 0)
    const second = list("second", 4, 50, 500, 1)
    expect(solveInlineFit({ budget: 600, content: 650, slots: [first, second] }).cuts).toEqual({
      second: 3,
    })
  })

  it("below 3 rows: the later lists first, the first list last", () => {
    // Both at 3 save 200 px (50 px rows); the second at 1 saves 100 more.
    expect(solveInlineFit(twoLists(600, 300)).cuts).toEqual({ first: 3, second: 1 })
    // 50 px more: then the first list gives too.
    expect(solveInlineFit(twoLists(600, 350)).cuts).toEqual({ first: 2, second: 1 })
  })

  it("keeps every list at 3 when the view cannot fit at 1 each", () => {
    expect(solveInlineFit(twoLists(600, 900))).toEqual({
      cuts: { first: 3, second: 3 },
      fits: false,
    })
  })

  it("is stable: solving its own result again changes nothing", () => {
    const first = list("first", 4, 50, 200, 0)
    const second = list("second", 3, 50, 500, 1)
    expect(solveInlineFit({ budget: 600, content: 600, slots: [first, second] }).cuts).toEqual({})
  })
})
