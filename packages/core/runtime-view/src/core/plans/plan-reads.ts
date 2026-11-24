import { BpmnProcessId, type VersionSummary } from "@miragon/pulse-engine-core"
import {
  MigrationPlanParser,
  MigrationPlanVersions,
  MigrationPlanVocabulary,
  type MigrationPlanDefinition,
  type MigrationPlanNote,
  type PlanSide,
} from "@miragon/pulse-migration-plan"
import { MigrationPlanning } from "../panels/migration-planning.js"
import { MigrationReads } from "../panels/migration-reads.js"
import { Problems } from "../panels/problems.js"
import type { Snapshot, Unavailable } from "../panels/view-session.js"
import type { EngineBadge, MigrationPlanView } from "../protocol/index.js"
import { MigrationElements } from "../views/migration-elements.js"
import type { PlanContext, PlanSource } from "./plan-context.js"
import { PlanMappings } from "./plan-mappings.js"
import { PlanProblems } from "./plan-problems.js"
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
    const parse = MigrationPlanParser.parse(text)
    return "problems" in parse
      ? { problem: PlanProblems.broken(source.fileName, parse.problems) }
      : parse
  }

  private static async versionsOf(
    context: PlanContext,
    plan: MigrationPlanDefinition,
  ): Promise<PlanVersions | Unavailable> {
    const versions = await context.runtime.listVersions(BpmnProcessId(plan.bpmnProcessId))
    const source = PlanReads.pick(versions, plan.bpmnProcessId, plan.source, context.engine)
    if ("problem" in source) {
      return source
    }
    const target = PlanReads.pick(versions, plan.bpmnProcessId, plan.target, context.engine)
    return "problem" in target ? target : { versions, source, target }
  }

  private static pick(
    versions: readonly VersionSummary[],
    bpmnProcessId: string,
    side: PlanSide,
    engine: EngineBadge,
  ): VersionSummary | Unavailable {
    const candidates = versions.map((summary) => ({ version: summary.definition.version, summary }))
    const pick = MigrationPlanVersions.pick(candidates, side.version)
    switch (pick.kind) {
      case "found":
        return pick.candidate.summary
      case "missing":
        return { problem: PlanProblems.missing(bpmnProcessId, side.version, engine) }
      default:
        return {
          problem: PlanProblems.ambiguous(bpmnProcessId, side.version, pick.count, engine),
        }
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
    const tokens = new Set<string>(MigrationReads.tokenElements({ statistics, sourceXml }))
    const elements = new MigrationElements(sourceXml, targetXml)
    const { accepted, refused } = PlanMappings.split(elements, plan.mappings, tokens)
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
