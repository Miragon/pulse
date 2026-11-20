import type { ProcessRowData } from "./engine-screen-data.js"

export type ProcessScope = "all" | "withIncident"

export interface ProcessFilterData {
  readonly scope: ProcessScope
  readonly search?: string
}

export type ProcessScopeCounts = Readonly<Record<ProcessScope, number>>

export interface FilteredProcessesData {
  readonly processes: readonly ProcessRowData[]
  readonly counts: ProcessScopeCounts
}

export class ProcessFilter {
  static apply(
    processes: readonly ProcessRowData[],
    filter: ProcessFilterData,
  ): FilteredProcessesData {
    const wanted = filter.search?.toLowerCase() ?? ""
    const found = processes.filter((row) => ProcessFilter.matches(row, wanted))
    const withIncident = found.filter((row) => row.withIncident > 0)
    return {
      processes: filter.scope === "withIncident" ? withIncident : found,
      counts: { all: found.length, withIncident: withIncident.length },
    }
  }

  private static matches(row: ProcessRowData, wanted: string): boolean {
    return [row.name ?? row.bpmnProcessId, row.bpmnProcessId].some((text) =>
      text.toLowerCase().includes(wanted),
    )
  }
}
