import type { DefinitionSummary } from "../../contract/index.js"
import type { IncidentSummaryRow, IncidentSummaryTile } from "../protocol/index.js"
import type { IncidentSummaryWidget } from "./board-definition.js"
import { EngineReads } from "./engine-reads.js"
import type { ProbedEngine } from "./engine-probe.js"

interface EngineSummaries {
  readonly engine: string
  readonly summaries?: readonly DefinitionSummary[]
}

const WITH_INCIDENT = { scope: "withIncident" } as const

export class IncidentSummaryTiles {
  static async build(
    widget: IncidentSummaryWidget,
    engines: readonly ProbedEngine[],
  ): Promise<IncidentSummaryTile> {
    const read = await Promise.all(
      engines.map(async (engine): Promise<EngineSummaries> => {
        const summaries =
          engine.reads === undefined
            ? undefined
            : EngineReads.valueOf(await engine.reads.summaries())
        return { engine: engine.status.name, ...(summaries === undefined ? {} : { summaries }) }
      }),
    )
    const known = read.filter((entry) => entry.summaries !== undefined)
    const rows =
      widget.groupBy === "engine"
        ? read.map((entry) => IncidentSummaryTiles.engineRow(entry))
        : known.flatMap((entry) => IncidentSummaryTiles.processRows(entry))
    return {
      kind: "incidentSummary",
      title: widget.title ?? "Instances with incident",
      groupBy: widget.groupBy,
      known: known.length,
      engines: read.length,
      rows,
      ...(known.length === 0 ? {} : { total: IncidentSummaryTiles.total(known) }),
    }
  }

  private static engineRow(entry: EngineSummaries): IncidentSummaryRow {
    return {
      engine: entry.engine,
      label: entry.engine,
      target: { engine: entry.engine, filter: WITH_INCIDENT },
      ...(entry.summaries === undefined
        ? {}
        : { withIncident: IncidentSummaryTiles.total([entry]) }),
    }
  }

  private static processRows(entry: EngineSummaries): IncidentSummaryRow[] {
    return (entry.summaries ?? [])
      .filter((summary) => summary.withIncident > 0)
      .sort((left, right) => right.withIncident - left.withIncident)
      .map((summary) => ({
        engine: entry.engine,
        label: summary.latest.name ?? summary.latest.bpmnProcessId,
        withIncident: summary.withIncident,
        target: {
          engine: entry.engine,
          bpmnProcessId: summary.latest.bpmnProcessId,
          filter: WITH_INCIDENT,
        },
      }))
  }

  private static total(entries: readonly EngineSummaries[]): number {
    return entries.reduce(
      (sum, entry) =>
        sum + (entry.summaries ?? []).reduce((inner, summary) => inner + summary.withIncident, 0),
      0,
    )
  }
}
