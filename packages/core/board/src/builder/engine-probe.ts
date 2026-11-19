import { type EngineInfo, RuntimeError } from "@miragon/pulse-engine-core"
import type { EngineModel } from "./board-model.js"
import type { EngineSource } from "./board-reads.js"
import { EngineReads, type Read } from "./engine-reads.js"

export interface ProbedEngine {
  readonly model: EngineModel
  readonly reads?: EngineReads
}

export class EngineProbe {
  static async probe(engine: EngineSource): Promise<ProbedEngine> {
    const source = engine.reads
    if (source === undefined) {
      return { model: { name: engine.name, state: "notConfigured" } }
    }
    try {
      const info = await source.describeEngine()
      return await EngineProbe.ready(engine.name, info, new EngineReads(source))
    } catch (error) {
      return { model: { name: engine.name, state: "failed", error } }
    }
  }

  private static async ready(
    name: string,
    info: EngineInfo,
    reads: EngineReads,
  ): Promise<ProbedEngine> {
    const read = await reads.summaries()
    const misconfigured = EngineProbe.misconfigured(read)
    if (misconfigured !== undefined) {
      return { model: { name, state: "failed", error: misconfigured } }
    }
    const summaries = EngineReads.valueOf(read)
    const totals =
      summaries === undefined
        ? {}
        : {
            totals: {
              running: summaries.reduce((sum, summary) => sum + summary.running, 0),
              withIncident: summaries.reduce((sum, summary) => sum + summary.withIncident, 0),
            },
          }
    return { model: { name, state: "ready", info, ...totals }, reads }
  }

  private static misconfigured({ error }: Read<unknown>): RuntimeError | undefined {
    return RuntimeError.is(error) && error.failure === "misconfigured" ? error : undefined
  }
}
