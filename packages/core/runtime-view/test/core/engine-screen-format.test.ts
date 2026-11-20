import type {
  ProcessFilterData as FormatFilter,
  ProcessRowData as FormatRow,
  ProcessScope as FormatScope,
  ProcessScopeCounts as FormatScopeCounts,
} from "@miragon/pulse-screens"
import { describe, expectTypeOf, test } from "vitest"
import type {
  EngineView,
  ProcessListFilter,
  ProcessRow,
  ProcessScope,
} from "../../src/core/protocol/index.js"

describe("the engine view of the protocol", () => {
  test("copies the screens' JSON form of a process row and its filter, without importing it", () => {
    expectTypeOf<ProcessRow>().toEqualTypeOf<FormatRow>()
    expectTypeOf<ProcessListFilter>().toEqualTypeOf<FormatFilter>()
    expectTypeOf<ProcessScope>().toEqualTypeOf<FormatScope>()
    expectTypeOf<EngineView["scopeCounts"]>().toEqualTypeOf<FormatScopeCounts>()
  })
})
