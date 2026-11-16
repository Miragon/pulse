import type {
  BoardColumn,
  BoardEngineStatus,
  BoardFilter,
  BoardTarget,
  BoardTile,
  BoardView,
  CountData,
  CounterTile,
  DefinitionData,
  IncidentSummaryRowData,
  IncidentSummaryTile,
  InstanceListTile,
  InstanceStateData,
  InstanceStateLabel,
  ProcessDiagramTile,
  RefusedTile,
} from "../../../core/protocol/index.js"
import { CountLabels } from "../../format/count-labels.js"
import { IdLabels } from "../../format/id-labels.js"

const ENVIRONMENTS = { local: "Local", test: "Test", production: "Production" } as const

const STATES: Readonly<Record<InstanceStateData, InstanceStateLabel>> = {
  running: "Running",
  suspended: "Suspended",
  completed: "Completed",
  terminated: "Cancelled",
}

export class BoardLabels {
  static title(tile: BoardTile): string {
    if (tile.kind === "refused") {
      return tile.title ?? (tile.widget === undefined ? "Widget" : `Widget "${tile.widget}"`)
    }
    return tile.widget.title ?? BoardLabels.untitled(tile)
  }

  static filterTitle(filter: BoardFilter): string {
    const parts = [
      filter.state === "running" ? "Running instances" : "Ended instances",
      filter.withIncident === true ? "with incident" : undefined,
      filter.withIncident === false ? "without incident" : undefined,
      filter.process === undefined ? undefined : `of ${filter.process}`,
      filter.activeElement === undefined ? undefined : `at ${filter.activeElement}`,
      filter.businessKey === undefined ? undefined : `with key ${filter.businessKey}`,
    ]
    return parts.filter((part) => part !== undefined).join(" ")
  }

  static columns(tile: InstanceListTile): readonly BoardColumn[] {
    const { columns, engines } = tile.widget
    return engines.length > 1 && !columns.includes("engine") ? ["engine", ...columns] : columns
  }

  static processName(definition: DefinitionData): string {
    return definition.name ?? definition.bpmnProcessId
  }

  static summaryLabel(row: IncidentSummaryRowData): string {
    return row.process === undefined ? row.engine : BoardLabels.processName(row.process)
  }

  static state(state: InstanceStateData): InstanceStateLabel {
    return STATES[state]
  }

  static shortId(id: string): string {
    return IdLabels.short(id)
  }

  static scope(view: BoardView): string {
    const names = view.engines.map((engine) => engine.name).join(", ")
    return `${CountLabels.plural(view.engines.length, "engine")}: ${names}`
  }

  static problems(view: BoardView): string {
    return view.rows.length > 0
      ? "Pulse shows the last valid version until you fix them."
      : "Pulse shows the board once you fix them."
  }

  static notes(view: BoardView): string {
    return view.notes.map((note) => `${note.path} ${note.reason}`).join("\n")
  }

  static engineFacts(engine: BoardEngineStatus): string {
    const environment = engine.badge?.environment
    return [
      environment === undefined || environment === "unclassified"
        ? undefined
        : ENVIRONMENTS[environment],
      engine.product,
      engine.running === undefined ? undefined : `${CountLabels.exact(engine.running)} running`,
      engine.withIncident === undefined
        ? undefined
        : `${CountLabels.exact(engine.withIncident)} with incident`,
    ]
      .filter((fact) => fact !== undefined)
      .join(" · ")
  }

  static partial(tile: CounterTile | IncidentSummaryTile): string | undefined {
    const engines = tile.kind === "counter" ? tile.readings.length : tile.engines
    return tile.known < engines
      ? `from ${tile.known} of ${CountLabels.plural(engines, "engine")}`
      : undefined
  }

  static openTitle(target: BoardTarget): string {
    const where =
      target.bpmnProcessId === undefined
        ? `Open the processes of ${target.engine}`
        : `Open the process on ${target.engine}, latest version first`
    return `${where} (Ctrl/Cmd+click: to the side)`
  }

  static above(tile: CounterTile): string | undefined {
    const above = tile.readings.filter((reading) => reading.above === true)
    const warnAbove = tile.widget.warnAbove
    if (warnAbove === undefined || above.length === 0) {
      return undefined
    }
    const limit = CountLabels.exact(warnAbove)
    return above.length === 1
      ? `${above[0]?.engine ?? ""} above ${limit}`
      : `${CountLabels.plural(above.length, "engine")} above ${limit}`
  }

  static warning(tile: CounterTile): string | undefined {
    const parts = [BoardLabels.above(tile), BoardLabels.undecided(tile)].filter(
      (part) => part !== undefined,
    )
    return parts.length === 0 ? undefined : parts.join(" · ")
  }

  static diagramFacts(engine: string, version: number): string {
    return `${engine} · v${version}, the latest version`
  }

  static diagramMissing(tile: ProcessDiagramTile): string {
    return tile.notDeployed === true
      ? `${tile.widget.process} is not deployed on ${tile.engine}, or you may not have permission to see it.`
      : `The diagram was not read from ${tile.engine}.`
  }

  static entryCount(count: CountData | undefined): string {
    return count === undefined ? "not read" : CountLabels.exact(count.count, count.atLeast === true)
  }

  static count(count: CountData | undefined): string {
    return count === undefined ? "—" : CountLabels.exact(count.count, count.atLeast === true)
  }

  private static untitled(tile: Exclude<BoardTile, RefusedTile>): string {
    switch (tile.kind) {
      case "counter":
      case "instanceList":
        return BoardLabels.filterTitle(tile.widget.filter)
      case "incidentSummary":
        return "Instances with incident"
      case "processDiagram":
        return tile.latest?.name ?? tile.widget.process
      case "incidentList":
        return tile.widget.process === undefined
          ? "Open incidents"
          : `Open incidents of ${tile.widget.process}`
    }
  }

  private static undecided(tile: CounterTile): string | undefined {
    const undecided = tile.readings.filter((reading) => reading.undecided === true)
    const [first] = undecided
    const warnAbove = tile.widget.warnAbove
    if (warnAbove === undefined || first === undefined) {
      return undefined
    }
    const stopped =
      undecided.length === 1
        ? `${first.engine} stopped counting at ${CountLabels.exact(first.count?.count ?? 0)}`
        : `${CountLabels.plural(undecided.length, "engine")} stopped counting`
    return `${stopped} · warns above ${CountLabels.exact(warnAbove)}`
  }
}
