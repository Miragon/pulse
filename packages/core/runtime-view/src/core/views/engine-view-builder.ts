import type { DefinitionSummary, EngineInfo } from "@miragon/pulse-engine-core"
import { ProcessFilter, type EngineScreenData, type ProcessRowData } from "@miragon/pulse-screens"
import { EngineScreen, ScreenJson } from "@miragon/pulse-screens/builder"
import type { EngineBadge, EngineView, ProcessListFilter } from "../protocol/index.js"
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
  private readonly screen: EngineScreenData

  constructor(private readonly snapshot: EngineSnapshot) {
    const { engine, asOf, definitions, info } = snapshot
    this.screen = ScreenJson.engine(
      EngineScreen.of({ engine: engine.name, asOf, definitions, info }),
    )
  }

  processOrder(): readonly string[] {
    return this.rows().map((row) => row.bpmnProcessId)
  }

  build(): EngineView {
    const { engine, filter } = this.snapshot
    const { processes, counts } = ProcessFilter.apply(this.rows(), filter)
    return {
      kind: "engine",
      engine: this.describedEngine(),
      asOf: this.screen.asOf,
      summary: this.summary(),
      processes,
      filter,
      scopeCounts: counts,
      emptyText:
        this.screen.totals.processes === 0
          ? `No processes deployed on ${engine.name}, or you may not have permission to see them.`
          : "No processes match this filter.",
      ...WebUiLinks.toStartPage(engine),
    }
  }

  private describedEngine(): EngineBadge {
    const info = this.screen.info
    return info === null
      ? this.snapshot.engine
      : { ...this.snapshot.engine, product: `${info.product} ${info.version}` }
  }

  private rows(): readonly ProcessRowData[] {
    const order = this.snapshot.order ?? []
    const positionOf = (row: ProcessRowData) => {
      const position = order.indexOf(row.bpmnProcessId)
      return position === -1 ? order.length : position
    }
    return [...this.screen.processes].sort((left, right) => positionOf(left) - positionOf(right))
  }

  private summary(): string {
    const { processes, running, withIncident } = this.screen.totals
    const counted = Labels.plural(processes, "process", "processes")
    return `${counted} · ${Labels.count(running)} running · ${Labels.count(withIncident)} with incident · all versions`
  }
}
