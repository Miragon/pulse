import type { EngineScreenData, EngineTotalsData, ProcessRowData } from "./engine-screen-data.js"
import { ProcessOrder } from "./process-order.js"

export interface FleetEngineData extends EngineTotalsData {
  readonly engine: string
}

export interface FleetCellData {
  readonly engine: string
  readonly running: number
  readonly withIncident: number
}

export interface FleetProcessData {
  readonly bpmnProcessId: string
  readonly name?: string
  readonly running: number
  readonly withIncident: number
  readonly engines: readonly FleetCellData[]
}

export interface FleetSumsData {
  readonly engines: readonly FleetEngineData[]
  readonly processes: readonly FleetProcessData[]
  readonly totals: EngineTotalsData
}

export class FleetSums {
  static of(screens: readonly EngineScreenData[]): FleetSumsData {
    const processes = FleetSums.processesOf(screens)
    return {
      engines: screens.map(({ engine, totals }) => ({ engine, ...totals })),
      processes,
      totals: {
        processes: processes.length,
        running: FleetSums.sum(screens.map(({ totals }) => totals.running)),
        withIncident: FleetSums.sum(screens.map(({ totals }) => totals.withIncident)),
      },
    }
  }

  private static processesOf(screens: readonly EngineScreenData[]): FleetProcessData[] {
    const rows = new Map<string, FleetProcessData>()
    for (const { engine, processes } of screens) {
      for (const row of processes) {
        const known = rows.get(row.bpmnProcessId)
        rows.set(row.bpmnProcessId, FleetSums.joined(known, row, engine))
      }
    }
    return [...rows.values()].sort((left, right) => ProcessOrder.compare(left, right))
  }

  private static joined(
    known: FleetProcessData | undefined,
    row: ProcessRowData,
    engine: string,
  ): FleetProcessData {
    const cell = { engine, running: row.running, withIncident: row.withIncident }
    const name = known?.name ?? row.name
    return {
      bpmnProcessId: row.bpmnProcessId,
      ...(name === undefined ? {} : { name }),
      running: (known?.running ?? 0) + cell.running,
      withIncident: (known?.withIncident ?? 0) + cell.withIncident,
      engines: [...(known?.engines ?? []), cell],
    }
  }

  private static sum(counts: readonly number[]): number {
    return counts.reduce((total, count) => total + count, 0)
  }
}
