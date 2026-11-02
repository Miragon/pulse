export type EngineHealthStatus = "ok" | "degraded" | "critical"

/** A cluster larger than the scan (`CLUSTER_SCAN_LIMIT`) is only a lower bound, never the scan's length. */
export interface ClusterCounts {
  /** The cluster's open incidents — null when unknown (only `scannedIncidentCount` of it is). */
  incidentCount: number | null
  /** The cluster's incidents among the newest scanned ones — a lower bound of `incidentCount`. */
  scannedIncidentCount: number
  /** Incidents since now − 24h — null when neither the scan nor a count can vouch for them. */
  last24hCount: number | null
}

/**
 * Same activity, type and message signature across processes. Carries only grounded
 * facts: interpreting it is the host agent's job. Counts are exact only when the scan
 * read every open incident.
 */
export interface EngineHealthCluster extends ClusterCounts {
  /** `${activityId}::${incidentType}::${messageSignature}` */
  id: string
  activityId: string
  /** The activity's name in the diagram of the sample incident's version — null without one (or unreadable). */
  activityName: string | null
  incidentType: string
  messageSignature: string
  /** Distinct process definition keys this cluster spans, most-affected first. */
  processDefinitionKeys: string[]
  /** Name of the most-affected process (its latest version) — null without one. */
  processDefinitionName: string | null
  /** A sample message + its incident id, for the drill-in and the AI prompt. */
  representativeMessage: string | null
  representativeIncidentId: string
  latestIncident: string | null
}

export interface EngineHealthData {
  status: EngineHealthStatus
  /** How `status` was decided, in words (source + thresholds) — `healthVerdictRule`. */
  statusRule: string
  summary: {
    totalIncidents: number
    /** New incidents in the last hour — the "is it burning right now?" signal. */
    lastHourIncidents: number
    last24hIncidents: number
    /** Activities with open incidents — null unless the incident scan read every incident. */
    affectedActivities: number | null
    affectedDefinitions: number
    runningInstances: number
    totalDefinitions: number
    /** Instances started in the last 24h — null when the history API is unavailable. */
    started24h: number | null
    /** Instances completed in the last 24h — null when the history API is unavailable. */
    completed24h: number | null
  }
  clusters: EngineHealthCluster[]
  /** When this snapshot was computed (ISO) — rendered as "as of …" for ops trust. */
  fetchedAt: string
  engineId: string
}

export interface ClusterIncidentRow {
  incidentId: string
  processInstanceId: string
  /** Business key of the affected instance — the operator's "order number". */
  businessKey: string | null
  processDefinitionKey: string
  /** The process's name (the incident's definition version) — null without one or unread. */
  processDefinitionName: string | null
  incidentTimestamp: string
}

/** Without a message filter the counts are `/incident/count` totals; with one, an unvouched count is null. */
export interface ClusterDetailData extends ClusterCounts {
  activityId: string
  /** The activity's name in the newest incident's diagram — null without one or unreadable. */
  activityName: string | null
  incidentType: string
  /** Signature the result was filtered by; null = no message filter (activity+type only). */
  messageSignature: string | null
  /** Incidents in the last hour — null when neither the scan nor a count can vouch for it. */
  lastHourCount: number | null
  /** Null unless the scan holds the whole cluster. */
  firstSeen: string | null
  latestIncident: string | null
  /** Distinct process definition keys of the scanned incidents, most-affected first. */
  processDefinitionKeys: string[]
  representativeMessage: string | null
  /** Most recent first. */
  incidents: ClusterIncidentRow[]
  /** The list's total: the scanned incidents after the business-key search (may exceed `incidents.length`). */
  totalMatching: number
  fetchedAt: string
  engineId: string
}
