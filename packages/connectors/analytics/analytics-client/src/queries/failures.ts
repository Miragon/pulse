import {
  engineIdsOf,
  engineMatcher,
  escapeLabelValue,
  selector,
  type EngineFilterInput,
  type PrometheusClient,
} from "../prometheus.js"
import { METRIC_NAMES as M } from "../metric-names.js"
import { engineState } from "./helpers.js"

/** The `camunda_incidents_open` gauge carries no message, activity, timestamps or instance ids. */
export interface ErrorPatternRow {
  incident_type: string
  process_definition_key: string
  incident_count: number
}

export interface FailedInstancesResult {
  engines: string[] | null
  patterns: ErrorPatternRow[]
}

// For the failed instances themselves, drill in with camunda7_list_incidents.
export async function findFailedInstances(
  ch: PrometheusClient,
  params: {
    processDefinitionKey?: string
    incidentType?: string
    maxResults: number
    engine?: EngineFilterInput
  },
): Promise<FailedInstancesResult> {
  const limit = Math.max(1, Math.floor(params.maxResults))
  const sel = selector(
    params.processDefinitionKey
      ? `process_definition_key="${escapeLabelValue(params.processDefinitionKey)}"`
      : undefined,
    params.incidentType ? `incident_type="${escapeLabelValue(params.incidentType)}"` : undefined,
    engineMatcher(params.engine),
  )

  const samples = await ch.instant(
    `sum by (process_definition_key, incident_type)(${engineState(M.incidentsOpen, sel)})`,
  )

  const patterns = samples
    .map((s) => ({
      incident_type: s.metric.incident_type ?? "",
      process_definition_key: s.metric.process_definition_key ?? "",
      incident_count: Math.round(s.value),
    }))
    .filter((r) => r.incident_count > 0)
    .sort((a, b) => b.incident_count - a.incident_count)
    .slice(0, limit)
  return { engines: engineIdsOf(params.engine), patterns }
}
