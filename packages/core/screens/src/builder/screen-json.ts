import type { DefinitionSummary, EngineInfo } from "@miragon/pulse-engine-core"
import type {
  EngineInfoData,
  EngineScreenData,
  ProcessRowData,
} from "../format/engine-screen-data.js"
import type { FindScreenData } from "../format/find-screen-data.js"
import type { InstanceListData } from "../format/instance-list-data.js"
import type { CallLinkData, InstanceScreenData } from "../format/instance-screen-data.js"
import type { ProcessScreenData } from "../format/process-screen-data.js"
import type { EngineScreenModel } from "./engine-screen-model.js"
import { FindJson } from "./find-json.js"
import type { FindModel } from "./finder-model.js"
import { InstanceJson } from "./instance-json.js"
import type { InstanceListModel } from "./instance-list-model.js"
import type { CallLinkModel, InstanceScreenModel } from "./instance-screen-model.js"
import { ProcessJson } from "./process-json.js"
import type { ProcessScreenModel } from "./process-screen-model.js"

export class ScreenJson {
  static engine(model: EngineScreenModel): EngineScreenData {
    const { processes, running, withIncident } = model.totals
    return {
      engine: model.engine,
      asOf: model.asOf.toISOString(),
      info: model.info === undefined ? null : ScreenJson.info(model.info),
      processes: model.processes.map((summary) => ScreenJson.processRow(summary)),
      totals: { processes, running, withIncident },
    }
  }

  static instance(model: InstanceScreenModel): InstanceScreenData {
    return InstanceJson.of(model)
  }

  static process(model: ProcessScreenModel): ProcessScreenData {
    return ProcessJson.of(model)
  }

  static instanceList(model: InstanceListModel): InstanceListData {
    return ProcessJson.list(model)
  }

  static find(model: FindModel): FindScreenData {
    return FindJson.of(model)
  }

  static callLinks(links: readonly CallLinkModel[]): CallLinkData[] {
    return InstanceJson.calls(links)
  }

  private static info({ product, version }: EngineInfo): EngineInfoData {
    return { product, version }
  }

  private static processRow(summary: DefinitionSummary): ProcessRowData {
    const { latest, running, withIncident, incidents, incidentsAtLeast } = summary
    return {
      bpmnProcessId: latest.bpmnProcessId,
      ...(latest.name === undefined ? {} : { name: latest.name }),
      latestVersion: latest.version,
      running,
      withIncident,
      incidents,
      ...(incidentsAtLeast === true ? { incidentsAtLeast } : {}),
    }
  }
}
