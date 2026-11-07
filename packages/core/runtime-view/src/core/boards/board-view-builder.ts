import type { BoardProblem, BoardTile, BoardView } from "../protocol/index.js"
import type { BoardDefinition, BoardWidget } from "./board-definition.js"
import type { BoardEngine } from "./board-engine.js"
import { CounterTiles } from "./counter-tiles.js"
import { EngineProbe, type ProbedEngine } from "./engine-probe.js"
import { IncidentListTiles } from "./incident-list-tiles.js"
import { IncidentSummaryTiles } from "./incident-summary-tiles.js"
import { InstanceListTiles } from "./instance-list-tiles.js"
import { ProcessDiagramTiles } from "./process-diagram-tiles.js"

export interface BoardSource {
  readonly fileName: string
  readonly asOf: Date
  readonly problems: readonly BoardProblem[]
}

export class BoardViewBuilder {
  static async build(
    board: BoardDefinition,
    engines: readonly BoardEngine[],
    source: BoardSource,
  ): Promise<BoardView> {
    const probed = await Promise.all(engines.map((engine) => EngineProbe.probe(engine)))
    const rows = await Promise.all(
      board.rows.map((row) =>
        Promise.all(row.map((widget) => BoardViewBuilder.tile(widget, probed))),
      ),
    )
    return {
      kind: "board",
      asOf: source.asOf.toISOString(),
      title: board.title,
      fileName: source.fileName,
      engines: probed.map((engine) => engine.status),
      rows,
      problems: source.problems,
    }
  }

  static unreadable(source: BoardSource): BoardView {
    return {
      kind: "board",
      asOf: source.asOf.toISOString(),
      title: source.fileName,
      fileName: source.fileName,
      engines: [],
      rows: [],
      problems: source.problems,
    }
  }

  private static tile(widget: BoardWidget, probed: readonly ProbedEngine[]): Promise<BoardTile> {
    const engines = probed.filter((engine) => widget.engines.includes(engine.status.name))
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
