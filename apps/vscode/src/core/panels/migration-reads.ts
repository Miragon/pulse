import {
  ElementId,
  type BpmnProcessId,
  type DefinitionId,
  type DefinitionRef,
  type ElementMapping,
  type ElementStatistics,
  type InstanceId,
  type MigrationProblem,
  type VersionSummary,
} from "../../contract/index.js"
import type { MigrationView } from "../protocol/index.js"
import { MigrationElements } from "../views/migration-elements.js"
import type { PanelContext } from "./panel-context.js"
import { Problems } from "./problems.js"
import type { Snapshot, Unavailable } from "./view-session.js"

const MAX_COUNTED_ELEMENTS = 10

export interface MigrationRequest {
  readonly sourceDefinitionId: DefinitionId
  readonly targetDefinitionId?: DefinitionId
  readonly instanceIds: readonly InstanceId[]
  readonly leftOut: readonly InstanceId[]
  readonly mappings?: readonly ElementMapping[]
}

export interface MigrationState {
  readonly asOf: Date
  readonly versions: readonly VersionSummary[]
  readonly source: DefinitionRef
  readonly target: DefinitionRef | undefined
  readonly sourceXml: string
  readonly targetXml: string | undefined
  readonly statistics: readonly ElementStatistics[]
  readonly instanceIds: readonly InstanceId[]
  readonly leftOut: readonly InstanceId[]
  readonly waiting: ReadonlyMap<string, readonly InstanceId[]>
  readonly mappings: readonly ElementMapping[]
  readonly problems: readonly MigrationProblem[]
  readonly checking: boolean
  readonly checkFailure: string | undefined
  readonly focused: string | undefined
}

export interface MigrationLoaded extends MigrationState, Snapshot<MigrationView> {}

export class MigrationReads {
  constructor(
    private readonly context: PanelContext,
    private readonly bpmnProcessId: BpmnProcessId,
  ) {}

  static tokenElements(state: Pick<MigrationState, "statistics" | "sourceXml">): string[] {
    const elements = new MigrationElements(state.sourceXml, undefined)
    return state.statistics
      .filter((element) => element.active + element.incidents > 0)
      .map((element) => element.elementId)
      .filter((elementId) => elements.holdsTokens(elementId))
  }

  async load(request: MigrationRequest): Promise<Omit<MigrationState, "checking"> | Unavailable> {
    const { runtime, diagrams } = this.context
    const source = request.sourceDefinitionId
    const [versions, sourceXml, statistics, instanceIds] = await Promise.all([
      runtime.listVersions(this.bpmnProcessId),
      diagrams.get(source),
      runtime.getElementStatistics(source),
      this.stillOnSource(source, request.instanceIds),
    ])
    const sourceRef = versions.find((version) => version.definition.id === source)?.definition
    if (sourceRef === undefined) {
      return { problem: Problems.notFound(`The version ${source}`) }
    }
    const target = this.targetOf(versions, sourceRef, request.targetDefinitionId)
    const [targetXml, mappings] = await this.targetParts(source, target, request.mappings)
    const leftOut = request.leftOut.filter((id) => instanceIds.includes(id))
    const [check, waiting] = await Promise.all([
      target === undefined
        ? Promise.resolve({ problems: [] })
        : runtime.checkMigration({
            sourceDefinitionId: source,
            targetDefinitionId: target.id,
            mappings,
          }),
      this.waitingAt(source, MigrationReads.tokenElements({ statistics, sourceXml }), {
        mappings,
        instanceIds,
      }),
    ])
    return {
      asOf: this.context.now(),
      versions,
      source: sourceRef,
      target,
      sourceXml,
      targetXml,
      statistics,
      instanceIds,
      leftOut,
      waiting,
      mappings,
      problems: check.problems,
      checkFailure: undefined,
      focused: undefined,
    }
  }

  async waitingAt(
    source: DefinitionId,
    tokenElements: readonly string[],
    selection: Pick<MigrationState, "mappings" | "instanceIds">,
  ): Promise<ReadonlyMap<string, readonly InstanceId[]>> {
    const { instanceIds } = selection
    const waiting = await Promise.all(
      MigrationReads.countedOf(tokenElements, selection.mappings).map(async (elementId) => {
        const page =
          instanceIds.length === 0
            ? { items: [] }
            : await this.context.runtime.searchInstances(
                {
                  definitionId: source,
                  instanceIds,
                  lifecycle: "running",
                  activeElementId: ElementId(elementId),
                },
                { limit: instanceIds.length },
              )
        return [elementId, page.items.map((instance) => instance.id)] as const
      }),
    )
    return new Map(waiting)
  }

  private static countedOf(
    tokenElements: readonly string[],
    mappings: readonly ElementMapping[],
  ): readonly string[] {
    if (tokenElements.length <= MAX_COUNTED_ELEMENTS) {
      return tokenElements
    }
    const mapped = new Set<string>(mappings.map((mapping) => mapping.sourceElementId))
    const unmapped = tokenElements.filter((elementId) => !mapped.has(elementId))
    return unmapped.length <= MAX_COUNTED_ELEMENTS ? unmapped : []
  }

  private async stillOnSource(
    source: DefinitionId,
    instanceIds: readonly InstanceId[],
  ): Promise<InstanceId[]> {
    if (instanceIds.length === 0) {
      return []
    }
    const page = await this.context.runtime.searchInstances(
      { definitionId: source, instanceIds, lifecycle: "running" },
      { limit: instanceIds.length },
    )
    return page.items.map((instance) => instance.id)
  }

  private targetOf(
    versions: readonly VersionSummary[],
    source: DefinitionRef,
    wanted: DefinitionId | undefined,
  ): DefinitionRef | undefined {
    const others = versions
      .map((version) => version.definition)
      .filter((ref) => ref.id !== source.id)
    if (wanted !== undefined) {
      return others.find((ref) => ref.id === wanted)
    }
    const latest = others[0]
    return latest !== undefined && latest.version > source.version ? latest : undefined
  }

  private async targetParts(
    source: DefinitionId,
    target: DefinitionRef | undefined,
    mappings: readonly ElementMapping[] | undefined,
  ): Promise<readonly [string | undefined, readonly ElementMapping[]]> {
    if (target === undefined) {
      return [undefined, []]
    }
    const [targetXml, proposal] = await Promise.all([
      this.context.diagrams.get(target.id),
      mappings === undefined
        ? this.context.runtime.proposeMigration(source, target.id)
        : Promise.resolve({ mappings }),
    ])
    return [targetXml, proposal.mappings]
  }
}
