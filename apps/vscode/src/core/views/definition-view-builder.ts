import type {
  CalledProcess,
  DefinitionId,
  ElementStatistics,
  InstanceSummary,
  VersionSummary,
} from "../../contract/index.js"
import type {
  DefinitionView,
  ElementBadge,
  EngineBadge,
  InstanceListFilter,
  InstanceRow,
  Notice,
  ScopeCounts,
  VersionOption,
} from "../protocol/index.js"
import { BpmnStructure } from "../bpmn/bpmn-structure.js"
import { CallLinks } from "./call-links.js"
import { Labels } from "./labels.js"
import { SubProcessRollUp } from "./sub-process-roll-up.js"
import { WebUiLinks } from "./web-ui-links.js"

export interface DefinitionSnapshot {
  readonly engine: EngineBadge
  readonly asOf: Date
  readonly versions: readonly VersionSummary[]
  readonly selectedDefinitionId: DefinitionId
  readonly diagramXml: string
  readonly statistics: readonly ElementStatistics[]
  readonly calledProcesses: readonly CalledProcess[]
  readonly instances: readonly InstanceSummary[]
  readonly hasMoreInstances: boolean
  readonly filter: InstanceListFilter
  readonly scopeCounts: ScopeCounts
  readonly extraNotices?: readonly Notice[]
}

type Identity = Pick<DefinitionView, "processName" | "bpmnProcessId" | "selectedVersion">

export class DefinitionViewBuilder {
  constructor(private readonly snapshot: DefinitionSnapshot) {}

  build(): DefinitionView {
    const identity = this.identityOf(this.selectedVersion())
    const subject = `${identity.processName} v${identity.selectedVersion}`
    return {
      kind: "definition",
      engine: this.snapshot.engine,
      asOf: this.snapshot.asOf.toISOString(),
      ...identity,
      versions: this.versionOptions(),
      selectedDefinitionId: this.snapshot.selectedDefinitionId,
      diagramXml: this.snapshot.diagramXml,
      badges: this.badges(),
      calls: CallLinks.ofDefinition(this.snapshot.calledProcesses).links(this.snapshot.engine.name),
      instances: this.snapshot.instances.map((instance) => this.instanceRow(instance)),
      hasMoreInstances: this.snapshot.hasMoreInstances,
      filter: this.snapshot.filter,
      scopeCounts: this.snapshot.scopeCounts,
      notices: this.notices(),
      ...WebUiLinks.to(subject, this.snapshot.engine),
    }
  }

  private selectedVersion(): VersionSummary | undefined {
    const selected = this.snapshot.versions.find(
      (version) => version.definition.id === this.snapshot.selectedDefinitionId,
    )
    return selected ?? this.snapshot.versions[0]
  }

  private identityOf(version: VersionSummary | undefined): Identity {
    const definition = version?.definition
    return {
      processName: definition?.name ?? definition?.bpmnProcessId ?? "",
      bpmnProcessId: definition?.bpmnProcessId ?? "",
      selectedVersion: definition?.version ?? 0,
    }
  }

  private versionOptions(): VersionOption[] {
    return this.snapshot.versions.map((version) => ({
      definitionId: version.definition.id,
      version: version.definition.version,
      running: version.running,
      withIncident: version.withIncident,
    }))
  }

  private badges(): ElementBadge[] {
    const structure = BpmnStructure.of(this.snapshot.diagramXml)
    return SubProcessRollUp.statistics(this.snapshot.statistics, structure)
      .filter(
        (statistic) =>
          statistic.active + statistic.incidents + statistic.incidentsInCalledInstances > 0,
      )
      .map((statistic) => ({
        elementId: statistic.elementId,
        running: statistic.active,
        incidents: statistic.incidents,
        incidentsInCalledInstances: statistic.incidentsInCalledInstances,
      }))
  }

  private instanceRow(instance: InstanceSummary): InstanceRow {
    return {
      id: instance.id,
      shortId: Labels.shortId(instance.id),
      state: Labels.instanceState(instance.state),
      hasIncident: instance.hasIncident,
      ...(instance.businessKey === undefined ? {} : { businessKey: instance.businessKey }),
      ...(instance.startedAt === undefined ? {} : { startedAt: instance.startedAt }),
    }
  }

  private notices(): Notice[] {
    const older = this.olderVersionsNotice()
    return [...(this.snapshot.extraNotices ?? []), ...(older === undefined ? [] : [older])]
  }

  private olderVersionsNotice(): Notice | undefined {
    const { versions, selectedDefinitionId } = this.snapshot
    const newest = versions[0]
    if (newest?.definition.id !== selectedDefinitionId) {
      return undefined
    }
    const olderRunning = versions.slice(1).filter((version) => version.running > 0)
    const firstOlder = olderRunning[0]
    if (firstOlder === undefined) {
      return undefined
    }
    const running = olderRunning.reduce((sum, version) => sum + version.running, 0)
    return {
      tone: "info",
      title: `${Labels.plural(running, "instance")} still run on older versions.`,
      actions: [
        {
          kind: "selectVersion",
          label: `Show v${firstOlder.definition.version}`,
          definitionId: firstOlder.definition.id,
        },
      ],
    }
  }
}
