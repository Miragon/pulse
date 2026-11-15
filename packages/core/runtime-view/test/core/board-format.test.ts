import type {
  BoardColumn as FormatColumn,
  BoardProblem as FormatProblem,
} from "@miragon/pulse-board"
import { describe, expectTypeOf, test } from "vitest"
import type { BoardColumn, BoardProblem } from "../../src/core/protocol/index.js"

describe("the board views of the protocol", () => {
  test("name the columns and the problems of the board format, without importing it", () => {
    expectTypeOf<BoardColumn>().toEqualTypeOf<FormatColumn>()
    expectTypeOf<BoardProblem>().toEqualTypeOf<FormatProblem>()
  })
})
