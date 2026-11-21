import type { EngineScreenData, EngineTotalsData } from "../format/engine-screen-data.js"
import type { FindScreenData } from "../format/find-screen-data.js"
import type { InstanceListData } from "../format/instance-list-data.js"
import type { InstanceScreenData } from "../format/instance-screen-data.js"
import type { ProcessScreenData } from "../format/process-screen-data.js"
import { FindFigures, type FindFiguresData } from "./find-figures.js"
import { InstanceFigures, type InstanceFiguresData } from "./instance-figures.js"
import {
  ProcessFigures,
  type InstanceListFiguresData,
  type ProcessFiguresData,
} from "./process-figures.js"

export interface EngineFiguresData {
  readonly processes: readonly (readonly [string, number, number, number])[]
  readonly totals: EngineTotalsData
}

export class ScreenFigures {
  static engine(data: EngineScreenData): EngineFiguresData {
    return {
      processes: data.processes.map(
        ({ bpmnProcessId, latestVersion, running, withIncident }) =>
          [bpmnProcessId, latestVersion, running, withIncident] as const,
      ),
      totals: data.totals,
    }
  }

  static instance(data: InstanceScreenData): InstanceFiguresData {
    return InstanceFigures.of(data)
  }

  static process(data: ProcessScreenData): ProcessFiguresData {
    return ProcessFigures.of(data)
  }

  static instanceList(data: InstanceListData): InstanceListFiguresData {
    return ProcessFigures.list(data)
  }

  static find(data: FindScreenData): FindFiguresData {
    return FindFigures.of(data)
  }
}
