import { Problems } from "../panels/problems.js"
import type { BoardEngineStatus } from "../protocol/index.js"
import type { BoardEngine } from "./board-engine.js"
import { EngineReads } from "./engine-reads.js"

export interface ProbedEngine {
  readonly status: BoardEngineStatus
  readonly reads?: EngineReads
}

type ConfiguredEngine = Extract<BoardEngine, { configured: true }>

export class EngineProbe {
  static async probe(engine: BoardEngine): Promise<ProbedEngine> {
    if (!engine.configured) {
      return { status: { name: engine.name, state: "notConfigured" } }
    }
    try {
      const info = await engine.runtime.describeEngine()
      return await EngineProbe.ready(engine, `${info.product} ${info.version}`)
    } catch (error) {
      return {
        status: {
          name: engine.name,
          state: "failed",
          badge: engine.badge,
          problem: Problems.of(error, engine.badge),
        },
      }
    }
  }

  private static async ready(engine: ConfiguredEngine, product: string): Promise<ProbedEngine> {
    const reads = new EngineReads(engine.runtime, engine.definitions)
    const summaries = EngineReads.valueOf(await reads.summaries())
    const totals =
      summaries === undefined
        ? {}
        : {
            running: summaries.reduce((sum, summary) => sum + summary.running, 0),
            withIncident: summaries.reduce((sum, summary) => sum + summary.withIncident, 0),
          }
    return {
      status: { name: engine.name, state: "ready", badge: engine.badge, product, ...totals },
      reads,
    }
  }
}
