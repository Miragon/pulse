import type { ListTenant, ProcessIncidentsData } from "../../view-models.js"
import { ENGINE_PROCESS_INCIDENTS_DATA } from "../../tool-names.js"
import { useViewData, type ViewDataResult } from "@miragon/pulse-widget-shell/widgets"

/** What each of the process detail's four widgets takes: the seed and the route's scope. */
export interface DefinitionScope {
  data?: ProcessIncidentsData | null
  processDefinitionKey: string
  /** The process's tenant the route names; without it the process the key names. */
  tenantId?: string
  engine: string
}

/**
 * One key for the view's four widgets, scoped to the route's process (its key and the tenant the
 * route names) and engine (never the default engine); the data seeds the feed, so a write's
 * invalidation refetches it too.
 */
export function useDefinitionData({
  data = null,
  processDefinitionKey,
  tenantId,
  engine,
}: DefinitionScope): ViewDataResult<ProcessIncidentsData> {
  return useViewData<ProcessIncidentsData>(
    data,
    ["engine:process-incidents", engine, processDefinitionKey, tenantId ?? null],
    ENGINE_PROCESS_INCIDENTS_DATA,
    { processDefinitionKey, ...(tenantId === undefined ? {} : { tenantId }), engine },
    true,
  )
}

/**
 * The lists of the process's runs (its instances, its jobs), as its counts count them: its key
 * alone where the key is deployed in its tenant alone (every key on an engine without tenants), so
 * a list holds what the tile counts, the runs a tenant id provider gave a tenant included; else its
 * key narrowed to the runs in its tenant (null: in none), so a key's other tenants list none of
 * theirs.
 */
export function listsOf(data: ProcessIncidentsData): {
  processDefinitionKey: string
  onlyTenant?: ListTenant
} {
  const key = { processDefinitionKey: data.processDefinitionKey }
  return data.sharesKey ? { ...key, onlyTenant: data.tenantId ?? null } : key
}
