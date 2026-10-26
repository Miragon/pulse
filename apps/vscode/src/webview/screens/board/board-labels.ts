import type {
  BoardEngineStatus,
  BoardTarget,
  BoardView,
  CounterTile,
  IncidentSummaryTile,
  ProcessDiagramTile,
} from "../../../core/protocol/index.js"
import { CountLabels } from "../../format/count-labels.js"

const ENVIRONMENTS = { local: "Local", test: "Test", production: "Production" } as const

export class BoardLabels {
  static scope(view: BoardView): string {
    const names = view.engines.map((engine) => engine.name).join(", ")
    return `${CountLabels.plural(view.engines.length, "engine")}: ${names}`
  }

  static problems(view: BoardView): string {
    return view.rows.length > 0
      ? "Pulse shows the last valid version until you fix them."
      : "Pulse shows the board once you fix them."
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
    const engines = tile.kind === "counter" ? tile.entries.length : tile.engines
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
    const above = tile.entries.filter((entry) => entry.above === true)
    if (tile.warnAbove === undefined || above.length === 0) {
      return undefined
    }
    const limit = CountLabels.exact(tile.warnAbove)
    return above.length === 1
      ? `${above[0]?.engine ?? ""} above ${limit}`
      : `${CountLabels.plural(above.length, "engine")} above ${limit}`
  }

  static diagramFacts(engine: string, version: number): string {
    return `${engine} · v${version}, the latest version`
  }

  static diagramMissing(tile: ProcessDiagramTile): string {
    return tile.notDeployed === true
      ? `${tile.bpmnProcessId} is not deployed on ${tile.engine}.`
      : `The diagram was not read from ${tile.engine}.`
  }

  static entryCount(count: number | undefined): string {
    return count === undefined ? "not read" : CountLabels.exact(count)
  }

  static count(count: number | undefined): string {
    return count === undefined ? "—" : CountLabels.exact(count)
  }
}
