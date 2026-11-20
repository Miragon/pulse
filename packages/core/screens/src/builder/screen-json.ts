import type { DefinitionSummary, EngineInfo } from "@miragon/pulse-engine-core"
import type {
  EngineInfoData,
  EngineScreenData,
  ProcessRowData,
} from "../format/engine-screen-data.js"
import type { EngineScreenModel } from "./engine-screen-model.js"

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

  private static info({ product, version }: EngineInfo): EngineInfoData {
    return { product, version }
  }

  private static processRow({ latest, running, withIncident }: DefinitionSummary): ProcessRowData {
    return {
      bpmnProcessId: latest.bpmnProcessId,
      ...(latest.name === undefined ? {} : { name: latest.name }),
      latestVersion: latest.version,
      running,
      withIncident,
    }
  }
}
