import {
  ElementId,
  type BpmnProcessId,
  type CalledProcess,
  type DefinitionId,
  type DefinitionRef,
  type ElementStatistics,
  type InstanceSummary,
  type ModelFile,
  type Page,
  type PageCursor,
  type VersionSummary,
} from "../../contract/index.js"
import type { DriftCheck } from "../drift/drift-check.js"
import type {
  DefinitionView,
  InstanceListFilter,
  Notice,
  Problem,
  ScopeCounts,
} from "../protocol/index.js"
import { RefreshCadence } from "../refresh/refresh-cadence.js"
import { DefinitionViewBuilder } from "../views/definition-view-builder.js"
import { ModelFactsView } from "../views/model-facts-view.js"
import type { CallJumps } from "./call-jumps.js"
import { InstanceListQuery } from "./instance-list-query.js"
import type { ElementLink, ModelLinks } from "./model-links.js"
import type { PanelContext } from "./panel-context.js"
import { Problems } from "./problems.js"
import type { Snapshot, Unavailable } from "./view-session.js"

export interface DefinitionLoaded extends Snapshot<DefinitionView> {
  readonly asOf: Date
  readonly versions: readonly VersionSummary[]
  readonly selected: DefinitionId
  readonly filter: InstanceListFilter
  readonly instances: readonly InstanceSummary[]
  readonly next: PageCursor | undefined
  readonly pages: number
  readonly scopeCounts: ScopeCounts
  readonly diagramXml: string
  readonly statistics: readonly ElementStatistics[]
  readonly calledProcesses: readonly CalledProcess[]
  readonly notices: readonly Notice[]
  readonly deployed: Notice | undefined
  readonly model: ModelFile | undefined
  readonly link: ElementLink | undefined
}

export interface DefinitionRequest {
  readonly selected: DefinitionId | undefined
  readonly filter: InstanceListFilter
}

export interface DefinitionParts {
  readonly drift: DriftCheck
  readonly jumps: CallJumps
  readonly links: ModelLinks
}

type LocalSourcesOf = Pick<DefinitionLoaded, "model" | "link">

export class DefinitionReads {
  private readonly instances: InstanceListQuery

  constructor(
    private readonly context: PanelContext,
    private readonly bpmnProcessId: BpmnProcessId,
    private readonly parts: DefinitionParts,
  ) {
    this.instances = new InstanceListQuery(context.runtime)
  }

  async load(request: DefinitionRequest): Promise<DefinitionLoaded | Unavailable> {
    const asOf = this.context.now()
    const versions = await this.context.runtime.listVersions(this.bpmnProcessId)
    const drift = await this.parts.drift.resolve(versions)
    const definition = this.chosenVersion(versions, request.selected ?? drift.matchingDefinitionId)
    if (definition === undefined) {
      return { problem: this.notDeployedProblem() }
    }
    const selected = definition.id
    const [diagramXml, statistics, page, scopeCounts, calledProcesses, local] = await Promise.all([
      this.context.diagrams.get(selected),
      this.context.runtime.getElementStatistics(selected),
      this.instances.page(selected, request.filter),
      this.instances.counts(selected, request.filter),
      this.parts.jumps.calledProcessesOf(selected),
      this.localSourcesOf(definition, request.filter),
    ])
    return this.snapshot({
      asOf,
      versions,
      selected,
      filter: request.filter,
      instances: page.items,
      next: page.next,
      pages: 1,
      scopeCounts,
      diagramXml,
      statistics,
      calledProcesses,
      notices: drift.notices,
      deployed: undefined,
      ...local,
    })
  }

  async refresh(loaded: DefinitionLoaded, tick: number): Promise<DefinitionLoaded | Unavailable> {
    const asOf = this.context.now()
    const environment = this.context.engine.environment
    const withHistory = RefreshCadence.readsHistory(tick, environment)
    const [versions, statistics, page, scopeCounts] = await Promise.all([
      RefreshCadence.readsVersions(tick, environment)
        ? this.context.runtime.listVersions(this.bpmnProcessId)
        : Promise.resolve(loaded.versions),
      this.context.runtime.getElementStatistics(loaded.selected),
      this.firstPageOf(loaded),
      this.instances.liveCounts(loaded.selected, loaded.filter, loaded.scopeCounts, withHistory),
    ])
    if (!versions.some((version) => version.definition.id === loaded.selected)) {
      return { problem: Problems.notFound(`Version v${loaded.view.selectedVersion}`) }
    }
    return this.snapshot({
      ...loaded,
      asOf,
      versions,
      statistics,
      instances: page.items,
      next: page.next,
      scopeCounts,
      deployed: this.deployedNotice(loaded, versions) ?? loaded.deployed,
    })
  }

  async more(loaded: DefinitionLoaded): Promise<DefinitionLoaded> {
    const page = await this.instances.page(loaded.selected, loaded.filter, loaded.next)
    const shown = new Set(loaded.instances.map((instance) => instance.id))
    return this.snapshot({
      ...loaded,
      instances: [...loaded.instances, ...page.items.filter((item) => !shown.has(item.id))],
      next: page.next,
      pages: loaded.pages + 1,
    })
  }

  private firstPageOf(loaded: DefinitionLoaded): Promise<Page<InstanceSummary>> {
    if (loaded.pages === 1) {
      return this.instances.page(loaded.selected, loaded.filter)
    }
    const next = loaded.next
    return Promise.resolve({ items: loaded.instances, ...(next === undefined ? {} : { next }) })
  }

  private deployedNotice(
    loaded: DefinitionLoaded,
    versions: readonly VersionSummary[],
  ): Notice | undefined {
    const known = new Set(loaded.versions.map((version) => version.definition.id))
    const newest = versions[0]?.definition
    if (newest === undefined || known.has(newest.id) || newest.id === loaded.selected) {
      return undefined
    }
    return {
      tone: "info",
      title: `v${newest.version} was deployed.`,
      actions: [
        { kind: "selectVersion", label: `Show v${newest.version}`, definitionId: newest.id },
      ],
    }
  }

  private async localSourcesOf(
    definition: DefinitionRef,
    filter: InstanceListFilter,
  ): Promise<LocalSourcesOf> {
    if (filter.elementId === undefined) {
      return {
        model: await this.parts.links.modelOf(definition.bpmnProcessId),
        link: undefined,
      }
    }
    const link = await this.parts.links.ofElement({
      definition,
      elementId: ElementId(filter.elementId),
    })
    return { model: link?.model, link }
  }

  private chosenVersion(
    versions: readonly VersionSummary[],
    wanted: DefinitionId | undefined,
  ): DefinitionRef | undefined {
    const known = versions.find((version) => version.definition.id === wanted)
    return (known ?? versions[0])?.definition
  }

  private snapshot(state: Omit<DefinitionLoaded, "view">): DefinitionLoaded {
    const view = new DefinitionViewBuilder({
      engine: this.context.engine,
      asOf: state.asOf,
      versions: state.versions,
      selectedDefinitionId: state.selected,
      diagramXml: state.diagramXml,
      statistics: state.statistics,
      calledProcesses: state.calledProcesses,
      instances: state.instances,
      hasMoreInstances: state.next !== undefined,
      filter: state.filter,
      scopeCounts: state.scopeCounts,
      extraNotices:
        state.deployed === undefined ? state.notices : [...state.notices, state.deployed],
    }).build()
    const model = state.model
    const noted = this.withHistoryNote(view)
    return {
      ...state,
      view:
        model === undefined
          ? noted
          : { ...noted, model: ModelFactsView.fileOf(model, state.diagramXml, state.link) },
    }
  }

  private withHistoryNote(view: DefinitionView): DefinitionView {
    const live = this.context.live?.switch.setting === "on"
    return live && !RefreshCadence.readsHistoryOnTicks(this.context.engine.environment)
      ? { ...view, historyNote: "Ended and All update when you refresh." }
      : view
  }

  private notDeployedProblem(): Problem {
    const fileName = this.parts.drift.fileName
    return fileName === undefined
      ? Problems.notFound(`The process ${this.bpmnProcessId}`)
      : {
          title: `${fileName} is not deployed on ${this.context.engine.name}.`,
          detail: `No version of ${this.bpmnProcessId} is deployed there. Deploy it, then refresh.`,
          canEditConnection: false,
        }
  }
}
