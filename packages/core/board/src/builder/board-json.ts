import type {
  DefinitionRef,
  ElementStatistics,
  Incident,
  InstanceCount,
  InstanceSummary,
} from "@miragon/pulse-engine-core"
import type {
  BadgeData,
  BoardData,
  CountData,
  CounterData,
  CounterReadingData,
  DefinitionData,
  EngineData,
  FailureData,
  IncidentData,
  IncidentGroupData,
  IncidentSummaryData,
  IncidentSummaryRowData,
  InstanceData,
  InstanceGroupData,
  ProcessDiagramData,
  RefusedData,
  TileData,
} from "../format/board-data.js"
import type { BoardProblem } from "../format/board-problems.js"
import type {
  BoardModel,
  CounterModel,
  CounterReading,
  EngineModel,
  IncidentGroupModel,
  IncidentSummaryModel,
  IncidentSummaryRowModel,
  InstanceGroupModel,
  ProcessDiagramModel,
  RefusedModel,
  TileModel,
} from "./board-model.js"

export interface BoardJsonOptions {
  readonly failureOf: (error: unknown) => FailureData
  readonly notes: readonly BoardProblem[]
}

export class BoardJson {
  static of(model: BoardModel, { failureOf, notes }: BoardJsonOptions): BoardData {
    return {
      title: model.title,
      engines: model.engines.map((engine) => BoardJson.engine(engine, failureOf)),
      rows: model.rows.map((row) => row.map((tile) => BoardJson.tile(tile))),
      notes,
    }
  }

  private static engine(engine: EngineModel, failureOf: BoardJsonOptions["failureOf"]): EngineData {
    const name = engine.name
    switch (engine.state) {
      case "notConfigured":
        return { name, state: "notConfigured" }
      case "failed":
        return { name, state: "failed", failure: failureOf(engine.error) }
      case "ready":
        return {
          name,
          state: "ready",
          product: engine.info.product,
          version: engine.info.version,
          ...(engine.totals === undefined
            ? {}
            : {
                totals: {
                  running: engine.totals.running,
                  withIncident: engine.totals.withIncident,
                },
              }),
        }
    }
  }

  private static tile(tile: TileModel): TileData {
    switch (tile.kind) {
      case "counter":
        return BoardJson.counter(tile)
      case "instanceList":
        return {
          kind: "instanceList",
          widget: tile.widget,
          groups: tile.groups.map((group) => BoardJson.instanceGroup(group)),
        }
      case "incidentSummary":
        return BoardJson.incidentSummary(tile)
      case "processDiagram":
        return BoardJson.processDiagram(tile)
      case "incidentList":
        return {
          kind: "incidentList",
          widget: tile.widget,
          groups: tile.groups.map((group) => BoardJson.incidentGroup(group)),
        }
      case "refused":
        return BoardJson.refused(tile)
    }
  }

  private static counter({ widget, readings, known, total }: CounterModel): CounterData {
    return {
      kind: "counter",
      widget,
      readings: readings.map((reading) => BoardJson.reading(reading)),
      known,
      ...(total === undefined ? {} : { total: BoardJson.count(total) }),
    }
  }

  private static reading({ engine, count, above, undecided }: CounterReading): CounterReadingData {
    return {
      engine,
      ...(count === undefined ? {} : { count: BoardJson.count(count) }),
      ...(above === undefined ? {} : { above }),
      ...(undecided === undefined ? {} : { undecided }),
    }
  }

  private static count({ count, atLeast }: InstanceCount): CountData {
    return { count, ...(atLeast === true ? { atLeast } : {}) }
  }

  private static instanceGroup({
    engine,
    instances,
    total,
  }: InstanceGroupModel): InstanceGroupData {
    return {
      engine,
      ...(instances === undefined
        ? {}
        : { instances: instances.map((instance) => BoardJson.instance(instance)) }),
      ...(total === undefined ? {} : { total: BoardJson.count(total) }),
    }
  }

  private static instance(instance: InstanceSummary): InstanceData {
    const { businessKey, startedAt, endedAt } = instance
    return {
      id: instance.id,
      definition: BoardJson.definition(instance.definition),
      state: instance.state,
      hasIncident: instance.hasIncident,
      ...(businessKey === undefined ? {} : { businessKey }),
      ...(startedAt === undefined ? {} : { startedAt }),
      ...(endedAt === undefined ? {} : { endedAt }),
    }
  }

  private static incidentSummary(tile: IncidentSummaryModel): IncidentSummaryData {
    return {
      kind: "incidentSummary",
      widget: tile.widget,
      engines: tile.engines,
      known: tile.known,
      ...(tile.total === undefined ? {} : { total: tile.total }),
      rows: tile.rows.map((row) => BoardJson.summaryRow(row)),
    }
  }

  private static summaryRow({
    engine,
    process,
    withIncident,
  }: IncidentSummaryRowModel): IncidentSummaryRowData {
    return {
      engine,
      ...(process === undefined ? {} : { process: BoardJson.definition(process) }),
      ...(withIncident === undefined ? {} : { withIncident }),
    }
  }

  private static processDiagram(tile: ProcessDiagramModel): ProcessDiagramData {
    const { latest, notDeployed, badges } = tile
    return {
      kind: "processDiagram",
      widget: tile.widget,
      engine: tile.engine,
      ...(latest === undefined ? {} : { latest: BoardJson.definition(latest) }),
      ...(notDeployed === undefined ? {} : { notDeployed }),
      ...(badges === undefined ? {} : { badges: badges.map((badge) => BoardJson.badge(badge)) }),
    }
  }

  private static badge(statistics: ElementStatistics): BadgeData {
    return {
      elementId: statistics.elementId,
      active: statistics.active,
      incidents: statistics.incidents,
      incidentsInCalledInstances: statistics.incidentsInCalledInstances,
    }
  }

  private static incidentGroup({ engine, incidents, more }: IncidentGroupModel): IncidentGroupData {
    return {
      engine,
      ...(incidents === undefined
        ? {}
        : { incidents: incidents.map((incident) => BoardJson.incident(incident)) }),
      ...(more === undefined ? {} : { more }),
    }
  }

  private static incident(incident: Incident): IncidentData {
    return {
      id: incident.id,
      instanceId: incident.instanceId,
      definition: BoardJson.definition(incident.definition),
      elementId: incident.elementId,
      type: incident.type,
      message: incident.message,
      createdAt: incident.createdAt,
    }
  }

  private static refused({ widget, title, problems }: RefusedModel): RefusedData {
    return {
      kind: "refused",
      ...(widget === undefined ? {} : { widget }),
      ...(title === undefined ? {} : { title }),
      problems,
    }
  }

  private static definition({ id, bpmnProcessId, version, name }: DefinitionRef): DefinitionData {
    return { id, bpmnProcessId, version, ...(name === undefined ? {} : { name }) }
  }
}
