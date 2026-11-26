import type {
  BpmnProcessId,
  CalledProcess,
  DefinitionId,
  ElementStatistics,
  InstanceSummary,
  VersionSummary,
} from "@miragon/pulse-engine-core"
import type {
  DefinitionRefData,
  InstanceRowData,
  ProcessNoticeData,
  ProcessScreenData,
  VersionData,
} from "@miragon/pulse-screens"
import { InstanceList, ProcessScreen, ScreenJson } from "@miragon/pulse-screens/builder"
import {
  VariableConditionRules,
  type DefinitionView,
  type EngineBadge,
  type InstanceListFilter,
  type InstanceRow,
  type Notice,
  type RefusedVariableCondition,
  type ScopeCounts,
  type VersionOption,
} from "../protocol/index.js"
import { CallLinks } from "./call-links.js"
import { Labels } from "./labels.js"
import { WebUiLinks } from "./web-ui-links.js"

export interface DefinitionSnapshot {
  readonly engine: EngineBadge
  readonly asOf: Date
  readonly bpmnProcessId: BpmnProcessId
  readonly versions: readonly VersionSummary[]
  readonly selectedDefinitionId: DefinitionId
  readonly diagramXml: string
  readonly statistics: readonly ElementStatistics[]
  readonly calledProcesses: readonly CalledProcess[]
  readonly instances: readonly InstanceSummary[]
  readonly hasMoreInstances: boolean
  readonly filter: InstanceListFilter
  readonly scopeCounts: ScopeCounts
  readonly refusedVariableConditions?: readonly RefusedVariableCondition[]
  readonly extraNotices?: readonly Notice[]
}

type Identity = Pick<DefinitionView, "processName" | "bpmnProcessId" | "selectedVersion">

export class DefinitionViewBuilder {
  constructor(private readonly snapshot: DefinitionSnapshot) {}

  build(): DefinitionView {
    const screen = this.screen()
    const identity = this.identityOf(screen.selected)
    const subject = `${identity.processName} v${identity.selectedVersion}`
    return {
      kind: "definition",
      engine: this.snapshot.engine,
      asOf: screen.asOf,
      ...identity,
      versions: screen.versions.map((version) => this.versionOption(version)),
      selectedDefinitionId: this.snapshot.selectedDefinitionId,
      diagramXml: this.snapshot.diagramXml,
      badges: screen.badges.map((badge) => ({ ...badge })),
      calls: CallLinks.ofDefinition(screen.calls).links(this.snapshot.engine.name),
      instances: this.rows().map((row) => this.instanceRow(row)),
      hasMoreInstances: this.snapshot.hasMoreInstances,
      filter: this.snapshot.filter,
      ...this.variableLabels(),
      ...this.refusedConditions(),
      scopeCounts: this.snapshot.scopeCounts,
      notices: [...(this.snapshot.extraNotices ?? [])],
      ...this.olderVersions(screen.notices),
      ...WebUiLinks.to(subject, this.snapshot.engine),
    }
  }

  private screen(): ProcessScreenData {
    const { snapshot } = this
    return ScreenJson.process(
      ProcessScreen.of({
        engine: snapshot.engine.name,
        asOf: snapshot.asOf,
        bpmnProcessId: snapshot.bpmnProcessId,
        versions: snapshot.versions,
        selected: snapshot.selectedDefinitionId,
        diagramXml: snapshot.diagramXml,
        statistics: snapshot.statistics,
        calledProcesses: snapshot.calledProcesses,
      }),
    )
  }

  private rows(): readonly InstanceRowData[] {
    const { snapshot } = this
    return ScreenJson.instanceList(
      InstanceList.of({
        engine: snapshot.engine.name,
        asOf: snapshot.asOf,
        definitionId: snapshot.selectedDefinitionId,
        page: { items: snapshot.instances },
        counts: snapshot.scopeCounts,
        refusedVariableConditions: snapshot.refusedVariableConditions ?? [],
      }),
    ).rows
  }

  private refusedConditions(): Pick<DefinitionView, "refusedVariableConditions"> {
    const refused = this.snapshot.refusedVariableConditions ?? []
    return refused.length === 0 ? {} : { refusedVariableConditions: refused }
  }

  private variableLabels(): Pick<DefinitionView, "variableLabels"> {
    const { variables } = this.snapshot.filter
    return variables === undefined
      ? {}
      : { variableLabels: variables.map((condition) => VariableConditionRules.label(condition)) }
  }

  private identityOf(definition: DefinitionRefData | null): Identity {
    return {
      processName: definition?.name ?? definition?.bpmnProcessId ?? "",
      bpmnProcessId: definition?.bpmnProcessId ?? "",
      selectedVersion: definition?.version ?? 0,
    }
  }

  private versionOption({ definition, running, withIncident }: VersionData): VersionOption {
    return { definitionId: definition.id, version: definition.version, running, withIncident }
  }

  private instanceRow(row: InstanceRowData): InstanceRow {
    return {
      id: row.id,
      shortId: Labels.shortId(row.id),
      state: Labels.instanceState(row.state),
      hasIncident: row.hasIncident,
      ...(row.businessKey === undefined ? {} : { businessKey: row.businessKey }),
      ...(row.startedAt === undefined ? {} : { startedAt: row.startedAt }),
    }
  }

  private olderVersions(
    notices: readonly ProcessNoticeData[],
  ): Pick<DefinitionView, "olderVersions"> {
    const [older] = notices
    return older === undefined
      ? {}
      : {
          olderVersions: {
            running: older.running,
            withIncident: older.withIncident,
            show: { definitionId: older.show.id, version: older.show.version },
          },
        }
  }
}
