import type { BoardProblem as FormatProblem, FailureData } from "@miragon/pulse-board"
import {
  BoardJson,
  type BoardModel,
  type EngineModel,
  type EngineSource,
} from "@miragon/pulse-board/builder"
import { Problems } from "../panels/problems.js"
import type { BoardEngineStatus, BoardProblem, BoardView, EngineBadge } from "../protocol/index.js"
import type { BoardEngine } from "./board-engine.js"
import { BoardRuntime } from "./board-runtime.js"
import { ProblemTexts } from "./problem-texts.js"
import { TileViews } from "./tile-views.js"

const FAILURE_THE_STATUS_WORDS: FailureData = { code: "unknown" }

export interface BoardSource {
  readonly fileName: string
  readonly asOf: Date
  readonly problems: readonly BoardProblem[]
  readonly notes: readonly FormatProblem[]
}

export class BoardViews {
  private readonly badges = new Map<string, EngineBadge>()
  private readonly runtimes = new Map<string, BoardRuntime>()

  constructor(private readonly engines: readonly BoardEngine[]) {
    for (const engine of engines) {
      if (engine.configured) {
        this.badges.set(engine.name, engine.badge)
        this.runtimes.set(engine.name, new BoardRuntime(engine.runtime, engine.definitions))
      }
    }
  }

  static unreadable(source: BoardSource): BoardView {
    return {
      kind: "board",
      asOf: source.asOf.toISOString(),
      title: source.fileName,
      fileName: source.fileName,
      engines: [],
      rows: [],
      problems: source.problems,
      notes: ProblemTexts.of(source.notes),
    }
  }

  sources(): EngineSource[] {
    return this.engines.map((engine) => {
      const reads = this.runtimes.get(engine.name)
      return reads === undefined ? { name: engine.name } : { name: engine.name, reads }
    })
  }

  async of(model: BoardModel, source: BoardSource): Promise<BoardView> {
    const { title, rows, notes } = BoardJson.of(model, {
      failureOf: () => FAILURE_THE_STATUS_WORDS,
      notes: source.notes,
    })
    const tiles = new TileViews(this.runtimes)
    return {
      kind: "board",
      asOf: source.asOf.toISOString(),
      title,
      fileName: source.fileName,
      engines: model.engines.map((engine) => this.status(engine)),
      rows: await Promise.all(rows.map((row) => Promise.all(row.map((tile) => tiles.of(tile))))),
      problems: source.problems,
      notes: ProblemTexts.of(notes),
    }
  }

  private status(engine: EngineModel): BoardEngineStatus {
    const name = engine.name
    const badge = this.badges.get(name)
    if (engine.state === "notConfigured" || badge === undefined) {
      return { name, state: "notConfigured" }
    }
    if (engine.state === "failed") {
      return { name, state: "failed", badge, problem: Problems.of(engine.error, badge) }
    }
    const product = `${engine.info.product} ${engine.info.version}`
    return { name, state: "ready", badge, product, ...engine.totals }
  }
}
