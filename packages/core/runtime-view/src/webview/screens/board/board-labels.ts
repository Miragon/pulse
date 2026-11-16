import type {
  BoardEngineStatus,
  BoardFileProblem,
  BoardView,
  ProblemData,
} from "../../../core/protocol/index.js"
import { CountLabels } from "../../format/count-labels.js"

const ENVIRONMENTS = { local: "Local", test: "Test", production: "Production" } as const

type ProblemWords = (problem: ProblemData) => string

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

  static fileProblem(problem: BoardFileProblem, say: ProblemWords): string {
    return problem.code === "unreadable" ? "could not be read" : say(problem)
  }

  static notes(view: BoardView, say: ProblemWords): string {
    return view.notes.map((note) => `${note.path} ${say(note)}`).join("\n")
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

  static openEngineTitle(engine: string): string {
    return `Open the processes of ${engine} (Ctrl/Cmd+click: to the side)`
  }
}
