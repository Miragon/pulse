import type {
  CounterData,
  IncidentSummaryData,
  ProcessDiagramData,
  TileData,
} from "@miragon/pulse-board"
import { DefinitionId } from "@miragon/pulse-engine-core"
import type {
  BoardTile,
  CounterTile,
  IncidentSummaryTile,
  ProcessDiagramTile,
} from "../protocol/index.js"
import { BoardFilters } from "./board-filters.js"
import type { BoardRuntime } from "./board-runtime.js"

const WITH_INCIDENT = { scope: "withIncident" } as const

export class TileViews {
  constructor(private readonly runtimes: ReadonlyMap<string, BoardRuntime>) {}

  of(tile: TileData): Promise<BoardTile> {
    switch (tile.kind) {
      case "counter":
        return Promise.resolve(TileViews.counter(tile))
      case "incidentSummary":
        return Promise.resolve(TileViews.incidentSummary(tile))
      case "processDiagram":
        return this.processDiagram(tile)
      default:
        return Promise.resolve(tile)
    }
  }

  private static counter(tile: CounterData): CounterTile {
    const filter = BoardFilters.listFilter(tile.widget.filter)
    const process = tile.widget.filter.process
    const scope = process === undefined ? {} : { bpmnProcessId: process }
    return {
      ...tile,
      targets:
        filter === undefined
          ? []
          : tile.readings.map(({ engine }) => ({ engine, ...scope, filter })),
    }
  }

  private static incidentSummary(tile: IncidentSummaryData): IncidentSummaryTile {
    return {
      ...tile,
      targets: tile.rows.map(({ engine, process }) => ({
        engine,
        ...(process === undefined ? {} : { bpmnProcessId: process.bpmnProcessId }),
        ...(process?.tenantId === undefined ? {} : { tenantId: process.tenantId }),
        filter: WITH_INCIDENT,
      })),
    }
  }

  private async processDiagram(tile: ProcessDiagramData): Promise<ProcessDiagramTile> {
    const diagramXml = await this.diagramXml(tile)
    return diagramXml === undefined ? tile : { ...tile, diagramXml }
  }

  private diagramXml({ engine, latest, badges }: ProcessDiagramData): Promise<string | undefined> {
    const runtime = this.runtimes.get(engine)
    if (latest === undefined || badges === undefined || runtime === undefined) {
      return Promise.resolve(undefined)
    }
    return runtime.getDiagramXml(DefinitionId(latest.id))
  }
}
