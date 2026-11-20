import type { EngineScreenData, EngineTotalsData } from "../format/engine-screen-data.js"
import type { InstanceScreenData } from "../format/instance-screen-data.js"
import { InstanceFigures, type InstanceFiguresData } from "./instance-figures.js"

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
}
