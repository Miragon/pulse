import { describe, expect, it } from "vitest"
import * as board from "./index.js"

describe("the @miragon/pulse-board entries", () => {
  it("export exactly the parser and the vocabulary of the board file format", () => {
    expect(Object.keys(board).sort()).toEqual(["BoardParser", "BoardVocabulary"])
  })
})
