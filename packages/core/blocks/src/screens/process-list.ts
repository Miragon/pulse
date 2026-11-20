import {
  ProcessFilter,
  type FilteredProcessesData,
  type ProcessFilterData,
  type ProcessRowData,
} from "@miragon/pulse-screens"
import { useMemo } from "react"

/**
 * The rows of an engine's process list under a filter and the counts of both scopes, derived in
 * the browser from the engine screen a surface loaded (`ProcessFilter` of `@miragon/pulse-screens`):
 * a scope or a search reads nothing again. For `ListFilterBar` and `ProcessTable`.
 */
export function useProcessList(
  processes: readonly ProcessRowData[],
  filter: ProcessFilterData,
): FilteredProcessesData {
  const { scope, search } = filter
  return useMemo(
    () => ProcessFilter.apply(processes, search === undefined ? { scope } : { scope, search }),
    [processes, scope, search],
  )
}
