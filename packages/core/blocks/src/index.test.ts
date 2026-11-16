import { describe, expect, it } from "vitest"
import * as blocks from "./index.js"

describe("the @miragon/pulse-blocks entry", () => {
  it("exports exactly the board's grid and tile, the problem list and the words of a problem", () => {
    expect(Object.keys(blocks).sort()).toStrictEqual([
      "BoardGrid",
      "BoardTile",
      "ProblemList",
      "useProblemWords",
    ])
  })
})
