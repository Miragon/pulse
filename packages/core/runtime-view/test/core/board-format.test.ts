import type {
  BoardColumn as FormatColumn,
  BoardFilter as FormatFilter,
  BoardProblem as FormatProblem,
  TileData as FormatTileData,
} from "@miragon/pulse-board"
import { describe, expectTypeOf, test } from "vitest"
import type {
  BoardColumn,
  BoardFileProblem,
  BoardFilter,
  BoardTile,
  CounterTile,
  IncidentSummaryTile,
  ProblemData,
  ProcessDiagramTile,
  RefusedTile,
  TileData,
} from "../../src/core/protocol/index.js"

describe("the board views of the protocol", () => {
  test("copy the board format's JSON form of a tile, without importing it", () => {
    expectTypeOf<BoardColumn>().toEqualTypeOf<FormatColumn>()
    expectTypeOf<BoardFilter>().toEqualTypeOf<FormatFilter>()
    expectTypeOf<ProblemData>().toEqualTypeOf<FormatProblem>()
    expectTypeOf<TileData>().toEqualTypeOf<FormatTileData>()
  })

  test("add to a tile only what the editors open and draw, never a problem's words", () => {
    expectTypeOf<BoardTile>().toExtend<FormatTileData>()
    expectTypeOf<Omit<CounterTile, "targets">>().toEqualTypeOf<
      Omit<Extract<FormatTileData, { kind: "counter" }>, never>
    >()
    expectTypeOf<Omit<IncidentSummaryTile, "targets">>().toEqualTypeOf<
      Omit<Extract<FormatTileData, { kind: "incidentSummary" }>, never>
    >()
    expectTypeOf<Omit<ProcessDiagramTile, "diagramXml">>().toEqualTypeOf<
      Omit<Extract<FormatTileData, { kind: "processDiagram" }>, never>
    >()
    expectTypeOf<RefusedTile>().toEqualTypeOf<Extract<FormatTileData, { kind: "refused" }>>()
    expectTypeOf<BoardFileProblem>().toEqualTypeOf<
      FormatProblem | { readonly path: "(file)"; readonly code: "unreadable" }
    >()
  })
})
