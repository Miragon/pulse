import type { BoardModel, EngineModel, EngineSource } from "@miragon/pulse-board/builder"
import { Problems } from "../panels/problems.js"
import type { BoardEngineStatus, BoardProblem, BoardView, EngineBadge } from "../protocol/index.js"
import type { BoardEngine } from "./board-engine.js"
import { BoardRuntime } from "./board-runtime.js"
import { TileViews } from "./tile-views.js"

export interface BoardSource {
  readonly fileName: string
  readonly asOf: Date
  readonly problems: readonly BoardProblem[]
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
    }
  }

  sources(): EngineSource[] {
    return this.engines.map((engine) => {
      const reads = this.runtimes.get(engine.name)
      return reads === undefined ? { name: engine.name } : { name: engine.name, reads }
    })
  }

  async of(model: BoardModel, source: BoardSource): Promise<BoardView> {
    const tiles = new TileViews(this.runtimes)
    const rows = await Promise.all(
      model.rows.map((row) => Promise.all(row.map((tile) => tiles.of(tile)))),
    )
    return {
      kind: "board",
      asOf: source.asOf.toISOString(),
      title: model.title,
      fileName: source.fileName,
      engines: model.engines.map((engine) => this.status(engine)),
      rows,
      problems: source.problems,
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
