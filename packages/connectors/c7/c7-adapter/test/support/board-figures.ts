import { BoardParser, type BoardData, type TileData } from "@miragon/pulse-board"
import { BoardBuilder, BoardJson, type BoardReads } from "@miragon/pulse-board/builder"
import { C7_BOARD_ENGINE } from "@miragon/pulse-c7-core/testing"

export class BoardFigures {
  static recordedBoard() {
    const parsed = BoardParser.parse(C7_BOARD_ENGINE.text)
    if (!("board" in parsed)) {
      throw new Error(JSON.stringify(parsed.problems))
    }
    return parsed
  }

  static async build(reads: BoardReads): Promise<BoardData> {
    const { board, notes } = BoardFigures.recordedBoard()
    const model = await BoardBuilder.build(board, [{ name: C7_BOARD_ENGINE.engine, reads }])
    return BoardJson.of(model, { failureOf: () => ({ code: "unknown" }), notes })
  }

  static of(data: BoardData) {
    return {
      engines: data.engines.map((engine) =>
        engine.state === "ready" ? engine.totals : engine.state,
      ),
      tiles: data.rows.flat().map((tile) => BoardFigures.tile(tile)),
    }
  }

  private static tile(tile: TileData): unknown {
    switch (tile.kind) {
      case "counter":
        return {
          readings: tile.readings.map(({ count, above }) => [count, above]),
          total: tile.total,
        }
      case "instanceList":
        return tile.groups.map(({ instances, total }) => ({
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
            tile.rows.map(({ process, withIncident }) => [process?.bpmnProcessId, withIncident]),
          ),
        }
      case "processDiagram":
        return { version: tile.latest?.version, badges: BoardFigures.unordered(tile.badges) }
      case "incidentList":
        return tile.groups.map(({ incidents, more }) => ({
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
