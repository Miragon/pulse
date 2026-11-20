import { describe, expect, it } from "vitest"
import * as blocks from "./index.js"

describe("the @miragon/pulse-blocks entry", () => {
  it("exports exactly the board's grid and tile, the problem list, the words of a problem and a note, and an engine's process list", () => {
    expect(Object.keys(blocks).sort()).toStrictEqual([
      "BoardGrid",
      "BoardTile",
      "ListFilterBar",
      "ProblemList",
      "ProcessTable",
      "useNoteLines",
      "useProblemWords",
      "useProcessList",
    ])
  })
})
