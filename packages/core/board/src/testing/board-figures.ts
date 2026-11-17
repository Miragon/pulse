import type { BoardData, EngineData, TileData } from "../format/board-data.js"

export interface BoardFiguresData {
  readonly engines: readonly unknown[]
  readonly tiles: readonly unknown[]
}

export class BoardFigures {
  static of(data: BoardData): BoardFiguresData {
    return {
      engines: data.engines.map((engine) => BoardFigures.engine(engine)),
      tiles: data.rows.flat().map((tile) => BoardFigures.tile(tile)),
    }
  }

  private static engine(engine: EngineData): unknown {
    return engine.state === "ready" ? engine.totals : engine.state
  }

  private static tile(tile: TileData): unknown {
    switch (tile.kind) {
      case "counter":
        return {
          readings: tile.readings.map(({ engine, count, above }) => [engine, count, above]),
          total: tile.total,
        }
      case "instanceList":
        return tile.groups.map(({ engine, instances, total }) => ({
          engine,
          total,
          rows: BoardFigures.unordered(
            instances?.map(({ businessKey, state, hasIncident, definition }) => [
              businessKey,
              state,
              hasIncident,
              definition.version,
            ]),
          ),
        }))
      case "incidentSummary":
        return {
          total: tile.total,
          rows: BoardFigures.unordered(
            tile.rows.map(({ engine, process, withIncident }) => [
              engine,
              process?.bpmnProcessId,
              withIncident,
            ]),
          ),
        }
      case "processDiagram":
        return {
          engine: tile.engine,
          version: tile.latest?.version,
          badges: BoardFigures.unordered(tile.badges),
        }
      case "incidentList":
        return tile.groups.map(({ engine, incidents, more }) => ({
          engine,
          more,
          rows: BoardFigures.unordered(incidents?.map(({ elementId }) => elementId)),
        }))
      case "refused":
        return tile.problems
    }
  }

  private static unordered(rows: readonly unknown[] | undefined): string[] | undefined {
    return rows?.map((row) => JSON.stringify(row)).sort()
  }
}
