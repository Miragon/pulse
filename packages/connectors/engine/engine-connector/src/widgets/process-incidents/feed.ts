import type { ProcessIncidentsData } from "../../view-models.js"
import { ENGINE_PROCESS_INCIDENTS_DATA } from "../../tool-names.js"
import { useViewData, type ViewDataResult } from "@miragon/pulse-widget-shell/widgets"

/** What each of the process detail's four widgets takes: the seed and the route's scope. */
export interface DefinitionScope {
  data?: ProcessIncidentsData | null
  processDefinitionKey: string
  engine: string
}

/**
 * One key for the view's four widgets, scoped to the route's process and engine (never the
 * default engine); the data seeds the feed, so a write's invalidation refetches it too.
 */
export function useDefinitionData({
  data = null,
  processDefinitionKey,
  engine,
}: DefinitionScope): ViewDataResult<ProcessIncidentsData> {
  return useViewData<ProcessIncidentsData>(
    data,
    ["engine:process-incidents", engine, processDefinitionKey],
    ENGINE_PROCESS_INCIDENTS_DATA,
    { processDefinitionKey, engine },
    true,
  )
}
