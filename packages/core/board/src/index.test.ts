import { describe, expect, it } from "vitest"
import * as board from "./index.js"
import * as testing from "./testing/index.js"

describe("the @miragon/pulse-board entries", () => {
  it("export exactly the parser, the words of its problems, the tiles a reader reads, the vocabulary and the starter board of the board file format", () => {
    expect(Object.keys(board).sort()).toStrictEqual([
      "BoardParser",
      "BoardProblems",
      "BoardTiles",
      "BoardVocabulary",
      "StarterBoard",
    ])
  })

  it("export exactly the shared fixtures from ./testing", () => {
    expect(Object.keys(testing).sort()).toStrictEqual(["BOARD_FIXTURES"])
  })
})
