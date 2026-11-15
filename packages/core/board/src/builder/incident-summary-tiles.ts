import type { DefinitionSummary } from "@miragon/pulse-engine-core"
import type { IncidentSummaryWidget } from "../format/board-definition.js"
import type { IncidentSummaryModel, IncidentSummaryRowModel } from "./board-model.js"
import type { ProbedEngine } from "./engine-probe.js"
import { EngineReads } from "./engine-reads.js"

interface EngineSummaries {
  readonly engine: string
  readonly summaries?: readonly DefinitionSummary[]
}

type KnownSummaries = Required<EngineSummaries>

export class IncidentSummaryTiles {
  static async build(
    widget: IncidentSummaryWidget,
    engines: readonly ProbedEngine[],
  ): Promise<IncidentSummaryModel> {
    const read = await Promise.all(
      engines.map(async (engine): Promise<EngineSummaries> => {
        const summaries =
          engine.reads === undefined
            ? undefined
            : EngineReads.valueOf(await engine.reads.summaries())
        return { engine: engine.model.name, ...(summaries === undefined ? {} : { summaries }) }
      }),
    )
    const known = read.filter((entry): entry is KnownSummaries => entry.summaries !== undefined)
    const rows =
      widget.groupBy === "engine"
        ? read.map((entry) => IncidentSummaryTiles.engineRow(entry))
        : known.flatMap((entry) => IncidentSummaryTiles.processRows(entry))
    return {
      kind: "incidentSummary",
      widget,
      engines: read.length,
      known: known.length,
      rows,
      ...(known.length === 0
        ? {}
        : {
            total: known.reduce(
              (sum, entry) => sum + IncidentSummaryTiles.total(entry.summaries),
              0,
            ),
          }),
    }
  }

  private static engineRow(entry: EngineSummaries): IncidentSummaryRowModel {
    return {
      engine: entry.engine,
      ...(entry.summaries === undefined
        ? {}
        : { withIncident: IncidentSummaryTiles.total(entry.summaries) }),
    }
  }

  private static processRows(entry: KnownSummaries): IncidentSummaryRowModel[] {
    return entry.summaries
      .filter((summary) => summary.withIncident > 0)
      .sort((left, right) => right.withIncident - left.withIncident)
      .map((summary) => ({
        engine: entry.engine,
        process: summary.latest,
        withIncident: summary.withIncident,
      }))
  }

  private static total(summaries: readonly DefinitionSummary[]): number {
    return summaries.reduce((sum, summary) => sum + summary.withIncident, 0)
  }
}
