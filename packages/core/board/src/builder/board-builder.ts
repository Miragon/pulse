import type { BoardDefinition, BoardTile, BoardWidget } from "../format/board-definition.js"
import type { BoardProblem } from "../format/board-problems.js"
import { BoardTiles } from "../format/board-tiles.js"
import { ParseProblems } from "../format/parse-problems.js"
import type { BoardModel, TileModel } from "./board-model.js"
import type { EngineSource } from "./board-reads.js"
import { CounterTiles } from "./counter-tiles.js"
import { EngineProbe, type ProbedEngine } from "./engine-probe.js"
import { IncidentListTiles } from "./incident-list-tiles.js"
import { IncidentSummaryTiles } from "./incident-summary-tiles.js"
import { InstanceListTiles } from "./instance-list-tiles.js"
import { ProcessDiagramTiles } from "./process-diagram-tiles.js"
import { RefusedTiles } from "./refused-tiles.js"

export class BoardBuilder {
  static async build(
    board: BoardDefinition,
    engines: readonly EngineSource[],
  ): Promise<BoardModel> {
    const probed = await Promise.all(engines.map((engine) => EngineProbe.probe(engine)))
    const rows = await Promise.all(
      BoardTiles.of(board).map((row) =>
        Promise.all(row.map((tile) => BoardBuilder.tile(tile, probed))),
      ),
    )
    const notes = BoardBuilder.notesOf(rows)
    return {
      title: board.title,
      engines: probed.map((engine) => engine.model),
      rows,
      ...(notes.length === 0 ? {} : { notes }),
    }
  }

  private static notesOf(rows: readonly (readonly TileModel[])[]): BoardProblem[] {
    return rows.flatMap((row, rowIndex) =>
      row.flatMap((tile, index) =>
        "diagramTooLong" in tile
          ? [
              {
                path: BoardBuilder.pathOf(rowIndex, index),
                code: "diagramTooLong" as const,
                values: tile.diagramTooLong,
              },
            ]
          : [],
      ),
    )
  }

  private static pathOf(rowIndex: number, index: number): string {
    return ParseProblems.index(
      ParseProblems.key(ParseProblems.index("rows", rowIndex), "row"),
      index,
    )
  }

  private static tile(tile: BoardTile, probed: readonly ProbedEngine[]): Promise<TileModel> {
    return "refused" in tile
      ? Promise.resolve(RefusedTiles.of(tile))
      : BoardBuilder.widget(tile, probed)
  }

  private static widget(widget: BoardWidget, probed: readonly ProbedEngine[]): Promise<TileModel> {
    const engines = probed.filter((engine) => widget.engines.includes(engine.model.name))
    switch (widget.widget) {
      case "counter":
        return CounterTiles.build(widget, engines)
      case "instanceList":
        return InstanceListTiles.build(widget, engines)
      case "incidentSummary":
        return IncidentSummaryTiles.build(widget, engines)
      case "processDiagram":
        return ProcessDiagramTiles.build(widget, engines)
      case "incidentList":
        return IncidentListTiles.build(widget, engines)
    }
  }
}
