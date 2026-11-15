import type { CounterWidget, InstanceListWidget } from "@miragon/pulse-board"
import type {
  CounterModel,
  CounterReading,
  IncidentGroupModel,
  IncidentListModel,
  IncidentSummaryModel,
  IncidentSummaryRowModel,
  InstanceGroupModel,
  InstanceListModel,
  ProcessDiagramModel,
  RefusedModel,
  TileModel,
} from "@miragon/pulse-board/builder"
import type { Incident, InstanceSummary } from "@miragon/pulse-engine-core"
import type {
  BoardColumn,
  BoardDiagram,
  BoardIncidentRow,
  BoardInstanceRow,
  BoardTile,
  CounterEntry,
  CounterTile,
  IncidentGroup,
  IncidentListTile,
  IncidentSummaryRow,
  IncidentSummaryTile,
  InstanceGroup,
  InstanceListTile,
  ProcessDiagramTile,
  RefusedTile,
} from "../protocol/index.js"
import { ElementBadges } from "../views/element-badges.js"
import { Labels } from "../views/labels.js"
import { BoardFilters } from "./board-filters.js"
import type { BoardRuntime } from "./board-runtime.js"
import { ProblemTexts } from "./problem-texts.js"

const WITH_INCIDENT = { scope: "withIncident" } as const

export class TileViews {
  constructor(private readonly runtimes: ReadonlyMap<string, BoardRuntime>) {}

  of(tile: TileModel): Promise<BoardTile> {
    switch (tile.kind) {
      case "counter":
        return Promise.resolve(TileViews.counter(tile))
      case "instanceList":
        return Promise.resolve(TileViews.instanceList(tile))
      case "incidentSummary":
        return Promise.resolve(TileViews.incidentSummary(tile))
      case "processDiagram":
        return this.processDiagram(tile)
      case "incidentList":
        return Promise.resolve(TileViews.incidentList(tile))
      case "refused":
        return Promise.resolve(TileViews.refused(tile))
    }
  }

  private static refused({ widget, title, problems }: RefusedModel): RefusedTile {
    return {
      kind: "refused",
      title: title ?? (widget === undefined ? "Widget" : `Widget "${widget}"`),
      ...(widget === undefined ? {} : { widget }),
      problems: ProblemTexts.of(problems),
    }
  }

  private static counter({ widget, readings, known, total }: CounterModel): CounterTile {
    return {
      kind: "counter",
      title: widget.title ?? BoardFilters.title(widget.filter),
      known,
      entries: readings.map((reading) => TileViews.entry(widget, reading)),
      ...(total === undefined ? {} : { total: total.count }),
      ...(total?.atLeast === true ? { totalAtLeast: true as const } : {}),
      ...(widget.warnAbove === undefined ? {} : { warnAbove: widget.warnAbove }),
      ...(widget.filter.withIncident === true ? { incident: true as const } : {}),
    }
  }

  private static entry(widget: CounterWidget, reading: CounterReading): CounterEntry {
    const { engine, count, ...verdict } = reading
    const filter = BoardFilters.listFilter(widget.filter)
    const process = widget.filter.process
    return {
      engine,
      ...(filter === undefined
        ? {}
        : {
            target: {
              engine,
              filter,
              ...(process === undefined ? {} : { bpmnProcessId: process }),
            },
          }),
      ...(count === undefined ? {} : { count: count.count }),
      ...(count?.atLeast === true ? { atLeast: true as const } : {}),
      ...verdict,
    }
  }

  private static instanceList({ widget, groups }: InstanceListModel): InstanceListTile {
    return {
      kind: "instanceList",
      title: widget.title ?? BoardFilters.title(widget.filter),
      columns: TileViews.columns(widget),
      groups: groups.map((group) => TileViews.instanceGroup(group)),
    }
  }

  private static columns(widget: InstanceListWidget): readonly BoardColumn[] {
    const several = widget.engines.length > 1
    return several && !widget.columns.includes("engine")
      ? ["engine", ...widget.columns]
      : widget.columns
  }

  private static instanceGroup({ engine, instances, total }: InstanceGroupModel): InstanceGroup {
    if (instances === undefined) {
      return { engine, rows: [], unavailable: true }
    }
    return {
      engine,
      rows: instances.map((instance) => TileViews.instanceRow(engine, instance)),
      ...(total === undefined ? {} : { total: total.count }),
      ...(total?.atLeast === true ? { totalAtLeast: true as const } : {}),
    }
  }

  private static instanceRow(engine: string, item: InstanceSummary): BoardInstanceRow {
    return {
      engine,
      id: item.id,
      shortId: Labels.shortId(item.id),
      processName: item.definition.name ?? item.definition.bpmnProcessId,
      bpmnProcessId: item.definition.bpmnProcessId,
      version: item.definition.version,
      state: Labels.instanceState(item.state),
      hasIncident: item.hasIncident,
      ...(item.businessKey === undefined ? {} : { businessKey: item.businessKey }),
      ...(item.startedAt === undefined ? {} : { startedAt: item.startedAt }),
      ...(item.endedAt === undefined ? {} : { endedAt: item.endedAt }),
    }
  }

  private static incidentSummary(tile: IncidentSummaryModel): IncidentSummaryTile {
    const { widget, total } = tile
    return {
      kind: "incidentSummary",
      title: widget.title ?? "Instances with incident",
      groupBy: widget.groupBy,
      known: tile.known,
      engines: tile.engines,
      rows: tile.rows.map((row) => TileViews.summaryRow(row)),
      ...(total === undefined ? {} : { total }),
    }
  }

  private static summaryRow({
    engine,
    process,
    withIncident,
  }: IncidentSummaryRowModel): IncidentSummaryRow {
    return {
      engine,
      label: process === undefined ? engine : (process.name ?? process.bpmnProcessId),
      ...(withIncident === undefined ? {} : { withIncident }),
      target: {
        engine,
        ...(process === undefined ? {} : { bpmnProcessId: process.bpmnProcessId }),
        filter: WITH_INCIDENT,
      },
    }
  }

  private static incidentList({ widget, groups }: IncidentListModel): IncidentListTile {
    return {
      kind: "incidentList",
      title:
        widget.title ??
        (widget.process === undefined ? "Open incidents" : `Open incidents of ${widget.process}`),
      groups: groups.map((group) => TileViews.incidentGroup(group)),
    }
  }

  private static incidentGroup({ engine, incidents, more }: IncidentGroupModel): IncidentGroup {
    if (incidents === undefined) {
      return { engine, rows: [], unavailable: true }
    }
    return {
      engine,
      rows: incidents.map((incident) => TileViews.incidentRow(engine, incident)),
      ...(more === undefined ? {} : { more }),
    }
  }

  private static incidentRow(engine: string, incident: Incident): BoardIncidentRow {
    return {
      engine,
      id: incident.id,
      instanceId: incident.instanceId,
      shortInstanceId: Labels.shortId(incident.instanceId),
      processName: incident.definition.name ?? incident.definition.bpmnProcessId,
      bpmnProcessId: incident.definition.bpmnProcessId,
      elementId: incident.elementId,
      message: incident.message,
      createdAt: incident.createdAt,
    }
  }

  private async processDiagram(tile: ProcessDiagramModel): Promise<ProcessDiagramTile> {
    const { widget, latest } = tile
    const diagram = await this.diagram(tile)
    return {
      kind: "processDiagram",
      title: widget.title ?? latest?.name ?? widget.process,
      engine: tile.engine,
      bpmnProcessId: widget.process,
      ...(tile.notDeployed === undefined ? {} : { notDeployed: tile.notDeployed }),
      ...(diagram === undefined ? {} : { diagram }),
    }
  }

  private async diagram({
    engine,
    latest,
    badges,
  }: ProcessDiagramModel): Promise<BoardDiagram | undefined> {
    const runtime = this.runtimes.get(engine)
    if (latest === undefined || badges === undefined || runtime === undefined) {
      return undefined
    }
    const diagramXml = await runtime.getDiagramXml(latest.id)
    if (diagramXml === undefined) {
      return undefined
    }
    return {
      processName: latest.name ?? latest.bpmnProcessId,
      version: latest.version,
      diagramXml,
      badges: ElementBadges.from(badges),
    }
  }
}
