import type { DefinitionRef } from "@miragon/pulse-engine-core"
import type { MigrationPlanNote } from "@miragon/pulse-migration-plan"
import { BULK_CAP } from "../panels/bulk-selection.js"
import { MigrationReads, type MigrationState } from "../panels/migration-reads.js"
import type {
  EngineBadge,
  MappingRow,
  MigrationPlanView,
  Notice,
  PlanMappingRow,
  PlanSideView,
  PlanVerdict,
  Tone,
} from "../protocol/index.js"
import { Labels } from "../views/labels.js"
import { MigrationElements } from "../views/migration-elements.js"
import { MigrationFacts } from "../views/migration-facts.js"
import { MigrationRows } from "../views/migration-rows.js"
import type { RefusedMapping } from "./plan-mappings.js"

export interface PlanState extends MigrationState {
  readonly target: DefinitionRef
  readonly targetXml: string
  readonly fileName: string
  readonly refused: readonly RefusedMapping[]
  readonly notes: readonly MigrationPlanNote[]
  readonly running: number
  readonly withIncident: number
}

export interface PlanScene {
  readonly engine: EngineBadge
}

export class PlanViewBuilder {
  private readonly rows: MigrationRows
  private readonly elements: MigrationElements
  private readonly tokens: ReadonlyMap<string, number>
  private readonly blocked: readonly string[]
  private readonly source: number
  private readonly target: number

  private constructor(
    private readonly state: PlanState,
    private readonly scene: PlanScene,
  ) {
    this.rows = new MigrationRows(state)
    this.elements = new MigrationElements(state.sourceXml, state.targetXml)
    const counted = new Set<string>(MigrationReads.tokenElements(state))
    this.tokens = new Map(
      state.statistics
        .filter((element) => counted.has(element.elementId))
        .map((element) => [element.elementId, element.active + element.incidents]),
    )
    this.blocked = this.rows.blocked().labels
    this.source = state.source.version
    this.target = state.target.version
  }

  static build(state: PlanState, scene: PlanScene): MigrationPlanView {
    return new PlanViewBuilder(state, scene).view()
  }

  private static sideOf(definition: DefinitionRef, diagramXml: string): PlanSideView {
    return { definitionId: definition.id, version: definition.version, diagramXml }
  }

  private static rankOf(row: PlanMappingRow): number {
    if (row.refused !== undefined) {
      return 0
    }
    if (row.problem !== undefined) {
      return 1
    }
    return row.unmappedTokens === true ? 2 : 3
  }

  private view(): MigrationPlanView {
    const { state } = this
    return {
      kind: "migrationPlan",
      engine: this.scene.engine,
      asOf: state.asOf.toISOString(),
      fileName: state.fileName,
      processName: state.source.name ?? state.source.bpmnProcessId,
      bpmnProcessId: state.source.bpmnProcessId,
      source: PlanViewBuilder.sideOf(state.source, state.sourceXml),
      target: PlanViewBuilder.sideOf(state.target, state.targetXml),
      running: state.running,
      withIncident: state.withIncident,
      rows: this.planRows(),
      ...(state.focused === undefined ? {} : { focused: state.focused }),
      summary: this.summary(),
      verdict: this.verdict(),
      facts: this.facts(),
      notices: this.notices(),
    }
  }

  private planRows(): PlanMappingRow[] {
    const refused = new Map(
      this.state.refused.map((entry) => [entry.mapping.sourceElementId, entry]),
    )
    const rows = this.rows.rows()
    const shown = new Set(rows.map((row) => row.sourceElementId))
    return [
      ...rows.map((row) => this.rowOf(row, refused.get(row.sourceElementId))),
      ...this.state.refused
        .filter((entry) => !shown.has(entry.mapping.sourceElementId))
        .map((entry) => this.ownRowOf(entry)),
    ].sort((left, right) => PlanViewBuilder.rankOf(left) - PlanViewBuilder.rankOf(right))
  }

  private rowOf(row: MappingRow, refused: RefusedMapping | undefined): PlanMappingRow {
    const tokens = this.tokens.get(row.sourceElementId)
    return {
      sourceElementId: row.sourceElementId,
      sourceLabel: row.sourceLabel,
      ...this.targetOf(refused?.mapping.targetElementId ?? row.targetElementId),
      ...(tokens === undefined ? {} : { tokens }),
      ...(refused === undefined ? {} : { refused: this.refusalOf(refused) }),
      ...(row.problem === undefined ? {} : { problem: row.problem }),
      ...(row.warning === undefined ? {} : { warning: row.warning }),
      ...(row.unmappedTokens === true ? { unmappedTokens: true as const } : {}),
    }
  }

  private ownRowOf(entry: RefusedMapping): PlanMappingRow {
    const { sourceElementId, targetElementId } = entry.mapping
    return {
      sourceElementId,
      sourceLabel: this.elements.sourceLabel(sourceElementId),
      ...this.targetOf(targetElementId),
      refused: this.refusalOf(entry),
    }
  }

  private targetOf(
    targetElementId: string | undefined,
  ): Pick<PlanMappingRow, "targetElementId" | "targetLabel"> {
    return targetElementId === undefined
      ? {}
      : { targetElementId, targetLabel: this.elements.targetLabel(targetElementId) }
  }

  private refusalOf({ mapping, refusal }: RefusedMapping): string {
    const elements = MigrationElements.elementPairOf(mapping)
    const sourceLabel = this.elements.sourceLabel(elements.sourceElementId)
    switch (refusal) {
      case "sourceMissing":
        return `v${this.source} has no element ${elements.sourceElementId}.`
      case "targetMissing":
        return `v${this.target} has no element ${elements.targetElementId}.`
      case "otherKind":
        return `${this.elements.targetLabel(elements.targetElementId)} in v${this.target} is of another kind than ${sourceLabel}.`
      case "otherScope":
        return `${mapping.sourceElementId} names a scope that ${sourceLabel} in v${this.source} doesn't have.`
      case "otherTargetScope":
        return `${mapping.sourceElementId} maps only to the same scope of an element in v${this.target}, not to ${mapping.targetElementId}.`
    }
  }

  private summary(): string {
    const refused = this.state.refused.length
    const problems = this.state.problems.length
    const unmapped = this.blocked.length
    const onlyLeftOut = refused > 0 && problems === 0 && unmapped === 0
    return [
      `${Labels.count(this.state.mappings.length)} mapped`,
      ...(refused > 0 ? [`${Labels.count(refused)} left out`] : []),
      ...(onlyLeftOut ? [] : [MigrationFacts.findings(problems, unmapped)]),
    ].join(" · ")
  }

  private verdict(): PlanVerdict {
    const { refused, problems } = this.state
    const [problem] = problems
    if (refused.length > 0) {
      const fit = refused.length === 1 ? "doesn't" : "don't"
      return {
        fits: false,
        text: `Pulse left out ${Labels.plural(refused.length, "mapping")} of the plan that ${fit} fit v${this.source} and v${this.target} on ${this.scene.engine.name}; the engine checked the rest.`,
      }
    }
    if (problem !== undefined) {
      return {
        fits: false,
        text: `The engine finds ${Labels.plural(problems.length, "problem")} in the plan: ${problem.message}`,
      }
    }
    if (this.blocked.length > 0) {
      return { fits: false, text: MigrationFacts.unmapped(this.blocked, this.target) }
    }
    return {
      fits: true,
      text: `The engine finds no problem in the plan, and every element where instances wait has a mapping in v${this.target}.`,
    }
  }

  private facts(): string[] {
    const { running, withIncident } = this.state
    const run = running === 1 ? "runs" : "run"
    return [
      `Pulse reads v${this.source} and v${this.target} of ${this.state.source.bpmnProcessId} on ${this.scene.engine.name} by their numbers.`,
      `A migration moves only the instances you select in the definition panel, at most ${Labels.count(BULK_CAP)} at a time.`,
      `${Labels.plural(running, "instance")} ${run} on v${this.source}, ${Labels.count(withIncident)} with incident.`,
      MigrationFacts.ownWay(this.source, running),
      ...this.rows.restartingTimers(),
      ...MigrationFacts.incidents(withIncident, this.target),
      ...MigrationFacts.modelFacts(this.elements),
      MigrationFacts.UNDONE,
    ]
  }

  private notices(): Notice[] {
    const { running, notes, versions } = this.state
    const cap = Labels.count(BULK_CAP)
    const keys = notes.map((note) => note.path).join(", ")
    return [
      PlanViewBuilder.notice(
        "info",
        "This preview starts nothing.",
        "Migrating in the definition panel doesn't use this file.",
      ),
      ...(running > BULK_CAP
        ? [
            PlanViewBuilder.notice(
              "warning",
              `More than ${cap} instances run on v${this.source}.`,
              `The definition panel migrates at most ${cap} at a time.`,
            ),
          ]
        : []),
      ...MigrationFacts.versionNotes(this.source, this.target, versions[0]?.definition.version).map(
        (title) => PlanViewBuilder.notice("info", title),
      ),
      ...(notes.length > 0
        ? [
            PlanViewBuilder.notice(
              "info",
              `Pulse ignores ${Labels.plural(notes.length, "key")} of the file: ${keys}.`,
            ),
          ]
        : []),
    ]
  }

  private static notice(tone: Tone, title: string, detail?: string): Notice {
    return { tone, title, ...(detail === undefined ? {} : { detail }), actions: [] }
  }
}
