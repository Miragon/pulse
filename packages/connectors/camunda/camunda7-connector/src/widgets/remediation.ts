// The prompt carries only ids and available tools; the playbook lives in the module instructions,
// gated by the same toolset. A widget never one-clicks a destructive batch.
import type { ToolSurface } from "@miragon/pulse-widget-shell/widgets"
import type { HandOff } from "./lib/hand-off.js"

import type { ClusterCounts } from "../view-models.js"

export const UNKNOWN_KEY = "(unknown)"

export interface RemediationCluster extends ClusterCounts {
  activityId: string
  incidentType: string
  processDefinitionKeys: string[]
  representativeMessage: string | null
}

// A capped scan (#335) vouches only for its share: never pass that off as the total.
export function clusterCountFacts(counts: ClusterCounts): {
  incidentCount?: number
  incidentCountAtLeast?: number
} {
  return counts.incidentCount === null
    ? { incidentCountAtLeast: counts.scannedIncidentCount }
    : { incidentCount: counts.incidentCount }
}

// Keys come from scanned incidents only; scoping a fix by a capped scan's keys (#335) would hide the rest of the cluster.
export function clusterScanComplete(counts: ClusterCounts): boolean {
  return counts.incidentCount !== null && counts.incidentCount <= counts.scannedIncidentCount
}

// One key scopes every call, several only the incident list; an incomplete scan states them as a fact instead.
export function clusterKeyParts(
  counts: ClusterCounts,
  processDefinitionKeys: readonly string[],
): {
  processDefinitionKey?: string
  processDefinitionKeyIn?: readonly string[]
  scannedProcessDefinitionKeys?: readonly string[]
} {
  const keys = processDefinitionKeys.filter((k) => k !== UNKNOWN_KEY)
  if (keys.length === 0) return {}
  if (!clusterScanComplete(counts)) return { scannedProcessDefinitionKeys: keys }
  return keys.length === 1 ? { processDefinitionKey: keys[0] } : { processDefinitionKeyIn: keys }
}

export interface RemediationHandOff {
  handOff: HandOff
  // Without a retry tool the hand-off is diagnosis + ticket draft, and the button says so.
  canFix: boolean
}

// `engine` is a boot-time enum, so a placeholder would be a refused call.
export function remediationHandOff(
  cluster: RemediationCluster,
  engine: string | undefined,
  surface: ToolSurface,
): RemediationHandOff {
  const keys = clusterKeyParts(cluster, cluster.processDefinitionKeys)
  // Confirmed only: a surface that cannot know offers the diagnosis.
  const canFix =
    surface.has("camunda7_set_job_retries") === true ||
    surface.has("camunda7_set_job_retries_batch") === true
  return {
    canFix,
    handOff: {
      intent: canFix ? "askAi.cluster.fix" : "askAi.cluster.diagnose",
      ids: {
        engine,
        activityId: cluster.activityId,
        incidentType: cluster.incidentType,
        processDefinitionKey: keys.processDefinitionKey,
        processDefinitionKeyIn: keys.processDefinitionKeyIn,
      },
      facts: {
        ...clusterCountFacts(cluster),
        scannedProcessDefinitionKeys: keys.scannedProcessDefinitionKeys,
        // An unknown 24h count is left out, never a 0 (#335).
        last24h: cluster.last24hCount ? cluster.last24hCount : undefined,
      },
      untrusted: [{ label: "sampleMessage", text: cluster.representativeMessage }],
      tools: [
        "camunda7_list_incidents",
        "camunda7_query_historic_incidents",
        "camunda7_get_job_stacktrace",
        "camunda7_list_jobs",
        "camunda7_get_process_instance_variables",
        "camunda7_set_process_instance_variable",
        "camunda7_set_job_retries",
        "camunda7_set_job_retries_batch",
        "camunda7_format_incident_issue",
      ],
    },
  }
}
