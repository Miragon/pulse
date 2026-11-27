import type { BoardDefinition, BoardTile, BoardWidget } from "../format/board-definition.js"
import type { BoardProblem } from "../format/board-problems.js"
import { BoardTiles } from "../format/board-tiles.js"
import { ParseProblems } from "../format/parse-problems.js"
import type { BoardModel, TileModel } from "./board-model.js"
import type { EngineSource } from "./board-reads.js"
import { CounterTiles } from "./counter-tiles.js"
import { DeadlineReads } from "./deadline-reads.js"
import { EngineProbe, type ProbedEngine } from "./engine-probe.js"
import { IncidentListTiles } from "./incident-list-tiles.js"
import { IncidentSummaryTiles } from "./incident-summary-tiles.js"
import { InstanceListTiles } from "./instance-list-tiles.js"
import { ProcessDiagramTiles } from "./process-diagram-tiles.js"
import { RefusedTiles } from "./refused-tiles.js"

export interface BoardBuildOptions {
  readonly engineDeadlineMs?: number
}

interface ProbingEngine {
  readonly name: string
  readonly probed: Promise<ProbedEngine>
}

export class BoardBuilder {
  static readonly ENGINE_DEADLINE_MS = 15_000

  static async build(
    board: BoardDefinition,
    engines: readonly EngineSource[],
    options: BoardBuildOptions = {},
  ): Promise<BoardModel> {
    const deadline = new DeadlineReads(options.engineDeadlineMs ?? BoardBuilder.ENGINE_DEADLINE_MS)
    try {
      return await BoardBuilder.read(
        board,
        engines.map((engine) => ({
          name: engine.name,
          probed: EngineProbe.probe(deadline.of(engine)),
        })),
      )
    } finally {
      deadline.end()
    }
  }

  private static async read(
    board: BoardDefinition,
    probing: readonly ProbingEngine[],
  ): Promise<BoardModel> {
    const rows = await Promise.all(
      BoardTiles.of(board).map((row) =>
        Promise.all(row.map((tile) => BoardBuilder.tile(tile, probing))),
      ),
    )
    const probed = await Promise.all(probing.map((engine) => engine.probed))
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

  private static tile(tile: BoardTile, probing: readonly ProbingEngine[]): Promise<TileModel> {
    return "refused" in tile
      ? Promise.resolve(RefusedTiles.of(tile))
      : BoardBuilder.widget(tile, probing)
  }

  private static widget(
    widget: BoardWidget,
    probing: readonly ProbingEngine[],
  ): Promise<TileModel> {
    const engines = probing
      .filter((engine) => widget.engines.includes(engine.name))
      .map((engine) => engine.probed)
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
