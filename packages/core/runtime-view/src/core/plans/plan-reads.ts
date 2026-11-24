import {
  BpmnProcessId,
  type ElementMapping,
  type MigrationProblem,
  type VersionSummary,
} from "@miragon/pulse-engine-core"
import {
  MigrationPlanParser,
  MigrationPlanVersions,
  MigrationPlanVocabulary,
  type MigrationPlanDefinition,
  type MigrationPlanNote,
  type MigrationPlanParse,
  type PlanSide,
} from "@miragon/pulse-migration-plan"
import { MigrationPlanning } from "../panels/migration-planning.js"
import { Problems } from "../panels/problems.js"
import type { Snapshot, Unavailable } from "../panels/view-session.js"
import type { EngineBadge, MigrationPlanView } from "../protocol/index.js"
import { MigrationElements } from "../views/migration-elements.js"
import type { PlanContext, PlanSource } from "./plan-context.js"
import { PlanEdits } from "./plan-edits.js"
import { PlanMappings } from "./plan-mappings.js"
import { PlanProblems, type PlanPlace } from "./plan-problems.js"
import { PlanViewBuilder, type PlanState } from "./plan-view-builder.js"

export interface PlanLoaded extends PlanState, Snapshot<MigrationPlanView> {}

interface ParsedPlan {
  readonly plan: MigrationPlanDefinition
  readonly notes: readonly MigrationPlanNote[]
}

interface PlanVersions {
  readonly versions: readonly VersionSummary[]
  readonly source: VersionSummary
  readonly target: VersionSummary
}

export class PlanReads {
  static async load(context: PlanContext): Promise<PlanLoaded | Unavailable> {
    const parsed = await PlanReads.parsed(context.source)
    if ("problem" in parsed) {
      return parsed
    }
    if (!MigrationPlanning.checks(context.runtime)) {
      return { problem: Problems.of(MigrationPlanning.unsupported(), context.engine) }
    }
    const versions = await PlanReads.versionsOf(context, parsed.plan)
    return "problem" in versions ? versions : PlanReads.checked(context, parsed, versions)
  }

  static snapshot(state: PlanState, engine: EngineBadge): PlanLoaded {
    return { ...state, view: PlanViewBuilder.build(state, { engine }) }
  }

  static async revised(
    context: PlanContext,
    loaded: PlanLoaded,
  ): Promise<PlanLoaded | "unchanged" | undefined> {
    const parsed = await PlanReads.parsed(context.source)
    if ("problem" in parsed || !PlanReads.sameVersions(parsed.plan, loaded)) {
      return undefined
    }
    const { plan, notes } = parsed
    const shown = PlanEdits.keyOf(PlanEdits.mappingsOf(loaded))
    const notesOf = (list: readonly MigrationPlanNote[]) => list.map((note) => note.path).join(",")
    if (PlanEdits.keyOf(plan.mappings) === shown && notesOf(notes) === notesOf(loaded.notes)) {
      return "unchanged"
    }
    const elements = new MigrationElements(loaded.sourceXml, loaded.targetXml)
    const { accepted, refused } = PlanMappings.split(elements, plan.mappings)
    return PlanReads.snapshot(
      {
        ...loaded,
        mappings: accepted,
        refused,
        notes,
        problems: PlanReads.stillShown(loaded.problems, accepted),
        checking: true,
        checkFailure: undefined,
      },
      context.engine,
    )
  }

  private static stillShown(
    problems: readonly MigrationProblem[],
    mappings: readonly ElementMapping[],
  ): MigrationProblem[] {
    const kept = new Set(mappings.map((pair) => PlanEdits.keyOf([pair])))
    return problems.filter(
      (problem) => problem.mapping === undefined || kept.has(PlanEdits.keyOf([problem.mapping])),
    )
  }

  private static sameVersions(plan: MigrationPlanDefinition, loaded: PlanLoaded): boolean {
    return (
      plan.bpmnProcessId === loaded.source.bpmnProcessId &&
      plan.source.version === loaded.source.version &&
      plan.target.version === loaded.target.version
    )
  }

  private static async parsed(source: PlanSource): Promise<ParsedPlan | Unavailable> {
    const max = MigrationPlanVocabulary.MAX_PLAN_CHARACTERS
    let text: string
    try {
      if ((await source.size()) > max) {
        const tooLarge = { path: "(file)", code: "tooLarge", values: { max } } as const
        return { problem: PlanProblems.broken(source.fileName, [tooLarge]) }
      }
      text = await source.read()
    } catch {
      return { problem: PlanProblems.unreadable(source.fileName) }
    }
    const parse = PlanReads.parse(text)
    if (parse === undefined) {
      return { problem: PlanProblems.broken(source.fileName, []) }
    }
    return "problems" in parse
      ? { problem: PlanProblems.broken(source.fileName, parse.problems) }
      : parse
  }

  private static parse(text: string): MigrationPlanParse | undefined {
    try {
      return MigrationPlanParser.parse(text)
    } catch {
      return undefined
    }
  }

  private static async versionsOf(
    context: PlanContext,
    plan: MigrationPlanDefinition,
  ): Promise<PlanVersions | Unavailable> {
    const versions = await context.runtime.listVersions(BpmnProcessId(plan.bpmnProcessId))
    const place: PlanPlace = {
      fileName: context.source.fileName,
      bpmnProcessId: plan.bpmnProcessId,
      engine: context.engine,
    }
    const source = PlanReads.pick(versions, place, plan.source)
    if ("problem" in source) {
      return source
    }
    const target = PlanReads.pick(versions, place, plan.target)
    return "problem" in target ? target : { versions, source, target }
  }

  private static pick(
    versions: readonly VersionSummary[],
    place: PlanPlace,
    side: PlanSide,
  ): VersionSummary | Unavailable {
    const candidates = versions.map((summary) => ({ version: summary.definition.version, summary }))
    const pick = MigrationPlanVersions.pick(candidates, side.version)
    switch (pick.kind) {
      case "found":
        return pick.candidate.summary
      case "missing":
        return { problem: PlanProblems.missing(place, side.version) }
      default:
        return { problem: PlanProblems.ambiguous(place, side.version, pick.count) }
    }
  }

  private static async checked(
    context: PlanContext,
    { plan, notes }: ParsedPlan,
    { versions, source, target }: PlanVersions,
  ): Promise<PlanLoaded> {
    const { runtime, diagrams } = context
    const [sourceXml, targetXml, statistics] = await Promise.all([
      diagrams.get(source.definition.id),
      diagrams.get(target.definition.id),
      runtime.getElementStatistics(source.definition.id),
    ])
    const elements = new MigrationElements(sourceXml, targetXml)
    const { accepted, refused } = PlanMappings.split(elements, plan.mappings)
    const check = await MigrationPlanning.check(runtime, {
      sourceDefinitionId: source.definition.id,
      targetDefinitionId: target.definition.id,
      mappings: accepted,
    })
    return PlanReads.snapshot(
      {
        asOf: context.now(),
        versions,
        source: source.definition,
        target: target.definition,
        sourceXml,
        targetXml,
        statistics,
        instanceIds: [],
        leftOut: [],
        waiting: new Map(),
        mappings: accepted,
        problems: check.problems,
        checking: false,
        checkFailure: undefined,
        focused: undefined,
        fileName: context.source.fileName,
        refused,
        notes,
        running: source.running,
        withIncident: source.withIncident,
      },
      context.engine,
    )
  }
}
