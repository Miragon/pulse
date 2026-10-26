import type {
  BoardEngineStatus,
  BoardView,
  CounterTile,
  IncidentSummaryRow,
  IncidentSummaryTile,
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

  static openTitle(row: IncidentSummaryRow): string {
    return row.target.bpmnProcessId === undefined
      ? `Open the processes of ${row.engine}`
      : `Open the process on ${row.engine}, latest version first`
  }

  static count(count: number | undefined): string {
    return count === undefined ? "—" : CountLabels.exact(count)
  }
}
