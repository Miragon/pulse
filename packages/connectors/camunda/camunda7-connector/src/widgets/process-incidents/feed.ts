import type { ProcessIncidentsData } from "../../view-models.js"
import { CAMUNDA7_PROCESS_INCIDENTS_DATA } from "../../tool-names.js"
import { useViewData, type ViewDataResult } from "@miragon/pulse-widget-shell/widgets"

/**
 * One key for the view's four widgets. Standalone reads scope from the data's echo, never the
 * default engine, and the data seeds the feed so a write's invalidation refetches it too.
 */
export function useDefinitionData(
  initialData: ProcessIncidentsData | null,
  processDefinitionKey: string | undefined,
  engine: string | undefined,
): ViewDataResult<ProcessIncidentsData> {
  const key = processDefinitionKey ?? initialData?.processDefinitionKey
  const feedEngine = engine ?? initialData?.engineId
  return useViewData<ProcessIncidentsData>(
    initialData,
    ["camunda7:process-incidents", feedEngine ?? null, key ?? null],
    CAMUNDA7_PROCESS_INCIDENTS_DATA,
    { processDefinitionKey: key, engine: feedEngine },
    !!key,
  )
}
