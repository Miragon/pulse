import type { DefinitionSummary } from "@miragon/pulse-engine-core"
import { ProcessOrder, type ProcessRank } from "../format/process-order.js"
import type { EngineFacts, EngineScreenModel, EngineScreenReads } from "./engine-screen-model.js"

export class EngineScreen {
  static async read(
    engine: string,
    reads: EngineScreenReads,
    now: () => Date,
  ): Promise<EngineScreenModel> {
    const asOf = now()
    const [definitions, info] = await Promise.all([
      reads.listDefinitions(),
      reads.describeEngine().catch(() => undefined),
    ])
    return EngineScreen.of({ engine, asOf, definitions, info })
  }

  static of({ engine, asOf, definitions, info }: EngineFacts): EngineScreenModel {
    return {
      engine,
      asOf,
      ...(info === undefined ? {} : { info }),
      processes: [...definitions].sort((left, right) =>
        ProcessOrder.compare(EngineScreen.rankOf(left), EngineScreen.rankOf(right)),
      ),
      totals: {
        processes: definitions.length,
        running: EngineScreen.sum(definitions, ({ running }) => running),
        withIncident: EngineScreen.sum(definitions, ({ withIncident }) => withIncident),
      },
    }
  }

  private static rankOf({ latest, running, withIncident }: DefinitionSummary): ProcessRank {
    const { bpmnProcessId, tenantId, name } = latest
    return { bpmnProcessId, tenantId, name, running, withIncident }
  }

  private static sum(
    definitions: readonly DefinitionSummary[],
    count: (summary: DefinitionSummary) => number,
  ): number {
    return definitions.reduce((total, summary) => total + count(summary), 0)
  }
}
