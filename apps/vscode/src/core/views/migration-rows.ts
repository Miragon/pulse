import type { InstanceId } from "../../contract/index.js"
import { MigrationReads, type MigrationState } from "../panels/migration-reads.js"
import type { MappingRow } from "../protocol/index.js"
import { MigrationElements } from "./migration-elements.js"

export interface BlockedTokens {
  readonly count: number
  readonly labels: readonly string[]
  readonly countable: boolean
}

export class MigrationRows {
  private readonly elements: MigrationElements
  private readonly targets: ReadonlyMap<string, string>
  private readonly tokens: ReadonlySet<string>
  private readonly selected: ReadonlySet<InstanceId>

  constructor(private readonly state: MigrationState) {
    this.elements = new MigrationElements(state.sourceXml, state.targetXml)
    this.targets = new Map(state.mappings.map((m) => [m.sourceElementId, m.targetElementId]))
    this.tokens = new Set(MigrationReads.tokenElements(state))
    const leftOut = new Set(state.leftOut)
    this.selected = new Set(state.instanceIds.filter((id) => !leftOut.has(id)))
  }

  get count(): number {
    return this.selected.size
  }

  rows(): MappingRow[] {
    const rows = this.elementIds().map((elementId) => this.rowOf(elementId))
    const rank = (row: MappingRow): number =>
      row.problem !== undefined ? 0 : row.unmappedTokens === true ? 1 : 2
    return rows.sort((left, right) => rank(left) - rank(right))
  }

  blocked(): BlockedTokens {
    const unmapped = [...this.tokens].filter((elementId) => this.isUnmappedWithTokens(elementId))
    return {
      count: unmapped.reduce((sum, elementId) => sum + (this.waitingAt(elementId) ?? 0), 0),
      labels: unmapped.map((elementId) => this.elements.sourceLabel(elementId)),
      countable: unmapped.every((elementId) => this.state.waiting.has(elementId)),
    }
  }

  blockedIds(): InstanceId[] {
    return [...this.tokens]
      .filter((elementId) => this.isUnmappedWithTokens(elementId))
      .flatMap((elementId) => this.state.waiting.get(elementId) ?? [])
      .filter((id) => this.selected.has(id))
  }

  restartingTimers(): string[] {
    return this.elementIds().flatMap((elementId) => {
      const warning = this.timerWarning(elementId)
      return warning === undefined ? [] : [warning]
    })
  }

  identical(): boolean {
    return (
      this.state.mappings.length > 0 &&
      this.state.mappings.every((m) => m.sourceElementId === m.targetElementId) &&
      this.elements.mappableSources().every((elementId) => this.targets.has(elementId))
    )
  }

  private elementIds(): string[] {
    return [
      ...new Set([
        ...this.elements.mappableSources(),
        ...this.state.mappings.map((mapping) => mapping.sourceElementId),
        ...this.tokens,
      ]),
    ]
  }

  private rowOf(elementId: string): MappingRow {
    const targetElementId = this.targets.get(elementId)
    const problem = this.state.problems.find(
      (candidate) => candidate.mapping?.sourceElementId === elementId,
    )?.message
    const waiting = this.waitingAt(elementId)
    const warning = this.timerWarning(elementId)
    return {
      sourceElementId: elementId,
      sourceLabel: this.elements.sourceLabel(elementId),
      candidates: this.elements.candidatesFor(elementId),
      ...(targetElementId === undefined ? {} : { targetElementId }),
      ...(problem === undefined ? {} : { problem }),
      ...(waiting === undefined || waiting === 0 ? {} : { waiting }),
      ...(this.isUnmappedWithTokens(elementId) ? { unmappedTokens: true as const } : {}),
      ...(warning === undefined ? {} : { warning }),
    }
  }

  private waitingAt(elementId: string): number | undefined {
    return this.state.waiting.get(elementId)?.filter((id) => this.selected.has(id)).length
  }

  private isUnmappedWithTokens(elementId: string): boolean {
    if (
      this.state.target === undefined ||
      this.targets.has(elementId) ||
      !this.tokens.has(elementId)
    ) {
      return false
    }
    const waiting = this.waitingAt(elementId)
    return waiting === undefined || waiting > 0
  }

  private timerWarning(elementId: string): string | undefined {
    const attachedTo = this.elements.restartingTimerOf(elementId)
    const unmapped = this.state.target !== undefined && !this.targets.has(elementId)
    if (attachedTo === undefined || !unmapped || !this.tokens.has(attachedTo)) {
      return undefined
    }
    const waiting = this.waitingAt(attachedTo)
    if (waiting === 0) {
      return undefined
    }
    return `The timer ${this.elements.sourceLabel(elementId)} at ${this.elements.sourceLabel(attachedTo)} starts again.`
  }
}
