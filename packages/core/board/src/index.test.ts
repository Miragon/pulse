import { describe, expect, it } from "vitest"
import * as board from "./index.js"
import * as testing from "./testing/index.js"

describe("the @miragon/pulse-board entries", () => {
  it("export exactly the parser, the vocabulary and the starter board of the board file format", () => {
    expect(Object.keys(board).sort()).toEqual(["BoardParser", "BoardVocabulary", "StarterBoard"])
  })

  it("export exactly the shared fixtures from ./testing", () => {
    expect(Object.keys(testing).sort()).toEqual(["BOARD_FIXTURES"])
  })
})
