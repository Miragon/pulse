import { describe, expect, test } from "vitest"
import { BoardParser, StarterBoard } from "../../src/index.js"
import { BOARD_FIXTURES } from "../../src/testing/index.js"

describe("the starter board", () => {
  test("is the file of the shared fixture, which both editors write", () => {
    const fixture = BOARD_FIXTURES.find((candidate) => candidate.name === "starter-board")

    expect(StarterBoard.of("Shop", ["shop-dev", "shop-test"])).toBe(fixture?.text)
  })

  test("reads back with its title and the engines it was given", () => {
    const parsed = BoardParser.parse(StarterBoard.of('Shop "Q4" \\ payments', ["shop-dev"]))

    expect(parsed).toHaveProperty("board.title", 'Shop "Q4" \\ payments')
    expect(parsed).toHaveProperty("board.engines", ["shop-dev"])
    expect(parsed).toHaveProperty("board.rows.length", 2)
  })

  test("without engines is written as it is, and the parser names the engines it lacks", () => {
    expect(BoardParser.parse(StarterBoard.of("Shop", []))).toStrictEqual({
      problems: [{ path: "engines", code: "engineNames" }],
    })
  })
})
