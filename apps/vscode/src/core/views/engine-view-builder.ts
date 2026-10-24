import type { DefinitionSummary, EngineInfo } from "../../contract/index.js"
import type { EngineBadge, EngineView, ProcessListFilter, ProcessRow } from "../protocol/index.js"
import { Labels } from "./labels.js"
import { WebUiLinks } from "./web-ui-links.js"

export interface EngineSnapshot {
  readonly engine: EngineBadge
  readonly asOf: Date
  readonly definitions: readonly DefinitionSummary[]
  readonly info: EngineInfo | undefined
  readonly filter: ProcessListFilter
  readonly order?: readonly string[]
}

export class EngineViewBuilder {
  constructor(private readonly snapshot: EngineSnapshot) {}

  processOrder(): readonly string[] {
    return this.rows().map((row) => row.bpmnProcessId)
  }

  build(): EngineView {
    const { engine, filter } = this.snapshot
    const found = this.rows().filter((row) => this.matchesSearch(row))
    const withIncident = found.filter((row) => row.withIncident > 0)
    return {
      kind: "engine",
      engine: this.describedEngine(),
      asOf: this.snapshot.asOf.toISOString(),
      summary: this.summary(),
      processes: filter.scope === "withIncident" ? withIncident : found,
      filter,
      scopeCounts: { all: found.length, withIncident: withIncident.length },
      emptyText:
        this.snapshot.definitions.length === 0
          ? `No processes deployed on ${engine.name}.`
          : "No processes match this filter.",
      ...WebUiLinks.toStartPage(engine),
    }
  }

  private describedEngine(): EngineBadge {
    const info = this.snapshot.info
    return info === undefined
      ? this.snapshot.engine
      : { ...this.snapshot.engine, product: `${info.product} ${info.version}` }
  }

  private rows(): ProcessRow[] {
    return this.snapshot.definitions
      .map((summary) => this.rowOf(summary))
      .sort(
        (left, right) =>
          this.shownBefore(left, right) ||
          right.withIncident - left.withIncident ||
          right.running - left.running ||
          this.nameOf(left).localeCompare(this.nameOf(right)),
      )
  }

  private shownBefore(left: ProcessRow, right: ProcessRow): number {
    const order = this.snapshot.order ?? []
    const positionOf = (row: ProcessRow) => {
      const position = order.indexOf(row.bpmnProcessId)
      return position === -1 ? order.length : position
    }
    return positionOf(left) - positionOf(right)
  }

  private rowOf({ latest, running, withIncident }: DefinitionSummary): ProcessRow {
    return {
      bpmnProcessId: latest.bpmnProcessId,
      ...(latest.name === undefined ? {} : { name: latest.name }),
      latestVersion: latest.version,
      running,
      withIncident,
    }
  }

  private nameOf(row: ProcessRow): string {
    return row.name ?? row.bpmnProcessId
  }

  private matchesSearch(row: ProcessRow): boolean {
    const wanted = this.snapshot.filter.search?.toLowerCase() ?? ""
    return [this.nameOf(row), row.bpmnProcessId].some((text) => text.toLowerCase().includes(wanted))
  }

  private summary(): string {
    const { definitions } = this.snapshot
    const running = definitions.reduce((sum, summary) => sum + summary.running, 0)
    const withIncident = definitions.reduce((sum, summary) => sum + summary.withIncident, 0)
    const processes = Labels.plural(definitions.length, "process", "processes")
    return `${processes} · ${running} running · ${withIncident} with incident`
  }
}
