import type { BoardDefinition, BoardWidget } from "../format/board-definition.js"
import type { BoardModel, TileModel } from "./board-model.js"
import type { EngineSource } from "./board-reads.js"
import { CounterTiles } from "./counter-tiles.js"
import { EngineProbe, type ProbedEngine } from "./engine-probe.js"
import { IncidentListTiles } from "./incident-list-tiles.js"
import { IncidentSummaryTiles } from "./incident-summary-tiles.js"
import { InstanceListTiles } from "./instance-list-tiles.js"
import { ProcessDiagramTiles } from "./process-diagram-tiles.js"

export class BoardBuilder {
  static async build(
    board: BoardDefinition,
    engines: readonly EngineSource[],
  ): Promise<BoardModel> {
    const probed = await Promise.all(engines.map((engine) => EngineProbe.probe(engine)))
    const rows = await Promise.all(
      board.rows.map((row) => Promise.all(row.map((widget) => BoardBuilder.tile(widget, probed)))),
    )
    return { title: board.title, engines: probed.map((engine) => engine.model), rows }
  }

  private static tile(widget: BoardWidget, probed: readonly ProbedEngine[]): Promise<TileModel> {
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
