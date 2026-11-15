import type {
  BoardColumn as FormatColumn,
  BoardProblem as FormatProblem,
  BoardProblems,
  RefusedWidget,
} from "@miragon/pulse-board"
import { describe, expectTypeOf, test } from "vitest"
import type { BoardColumn, BoardProblem, RefusedTile } from "../../src/core/protocol/index.js"

describe("the board views of the protocol", () => {
  test("name the columns of the board format and its problems in words, without importing it", () => {
    expectTypeOf<BoardColumn>().toEqualTypeOf<FormatColumn>()
    expectTypeOf<BoardProblem>().toEqualTypeOf<{
      readonly path: FormatProblem["path"]
      readonly reason: ReturnType<typeof BoardProblems.describe>
    }>()
    expectTypeOf<RefusedTile["widget"]>().toEqualTypeOf<RefusedWidget["widget"]>()
  })
})
