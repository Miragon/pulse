import type { ElementStatistics, InstanceSummary, VersionSummary } from "@miragon/pulse-engine-core"
import type { InstanceListData, InstanceRowData } from "../format/instance-list-data.js"
import type {
  ElementBadgeData,
  ProcessNoticeData,
  ProcessScreenData,
  VersionData,
} from "../format/process-screen-data.js"
import { DefinitionJson } from "./definition-json.js"
import { InstanceJson } from "./instance-json.js"
import type { InstanceListModel } from "./instance-list-model.js"
import type { ProcessNoticeModel, ProcessScreenModel } from "./process-screen-model.js"
import { Fields } from "./present.js"

export class ProcessJson {
  static of(model: ProcessScreenModel): ProcessScreenData {
    return {
      engine: model.engine,
      asOf: model.asOf.toISOString(),
      bpmnProcessId: model.bpmnProcessId,
      selected: model.selected === undefined ? null : DefinitionJson.of(model.selected.definition),
      versions: model.versions.map((version) => ProcessJson.version(version)),
      badges: model.badges.map((badge) => ProcessJson.badge(badge)),
      calls: InstanceJson.calls(model.calls),
      notices: model.notices.map((notice) => ProcessJson.notice(notice)),
      unread: [...model.unread],
    }
  }

  static list(model: InstanceListModel): InstanceListData {
    return {
      engine: model.engine,
      asOf: model.asOf.toISOString(),
      definitionId: model.definitionId,
      rows: model.rows.map((row) => ProcessJson.row(row)),
      next: model.next ?? null,
      counts: model.counts === undefined ? null : { ...model.counts },
      refusedVariableConditions: [...model.refusedVariableConditions],
    }
  }

  private static version({ definition, running, withIncident }: VersionSummary): VersionData {
    return { definition: DefinitionJson.of(definition), running, withIncident }
  }

  private static badge(statistic: ElementStatistics): ElementBadgeData {
    const { elementId, active, incidents, incidentsInCalledInstances } = statistic
    return { elementId, running: active, incidents, incidentsInCalledInstances }
  }

  private static notice({
    code,
    running,
    withIncident,
    show,
  }: ProcessNoticeModel): ProcessNoticeData {
    return { code, running, withIncident, show: DefinitionJson.of(show) }
  }

  private static row(instance: InstanceSummary): InstanceRowData {
    const { id, state, hasIncident, businessKey, startedAt } = instance
    return { id, state, hasIncident, ...Fields.present({ businessKey, startedAt }) }
  }
}
