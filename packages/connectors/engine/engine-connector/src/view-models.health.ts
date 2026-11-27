import type { EngineStatus, OutsideAnyProcess } from "@miragon/pulse-c7-core"

/** c7-core's live verdict (`engineVerdict`), the one `engine_status` gives too. */
export type EngineHealthStatus = EngineStatus

/**
 * A cluster is one cause, so it counts root incidents alone (a call activity's copy of a called
 * instance's failure is that failure's). A cluster larger than the scan (`CLUSTER_SCAN_LIMIT`) is
 * only a lower bound, never the scan's length.
 */
export interface ClusterCounts {
  /** The cluster's open root incidents; null when unknown (only `scannedIncidentCount` of it is). */
  incidentCount: number | null
  /** The cluster's root incidents among the newest scanned ones, a lower bound of `incidentCount`. */
  scannedIncidentCount: number
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
  /** The activity's name in the diagram of the sample incident's version; null without one (or unreadable). */
  activityName: string | null
  incidentType: string
  messageSignature: string
  /** Distinct process definition keys this cluster spans, most-affected first. */
  processDefinitionKeys: string[]
  /** Name of the most-affected process (its latest version); null without one. */
  processDefinitionName: string | null
  /** A sample message + its incident id, for the drill-in and the AI prompt. */
  representativeMessage: string | null
  representativeIncidentId: string
  latestIncident: string | null
}

export interface EngineHealthData {
  status: EngineHealthStatus
  /** How `status` was decided, in words (source + thresholds): `healthVerdictRule`. */
  statusRule: string
  /**
   * Its incident counts are open ROOT incidents: a call activity's copy of a called instance's
   * incident counts where it was raised. `status` judges root incidents too, those outside any
   * process (a batch's failed job) beside these.
   */
  summary: {
    /** The open root incidents of every process (the definition statistics, `rootIncidents=true`). */
    totalIncidents: number
    /**
     * The open root incidents outside any process (a batch's or the history cleanup's failed job),
     * which no process counts and `status` judges: a line of their own, never summed into
     * `totalIncidents`; `atLeast` where the incident scan stops (`CLUSTER_SCAN_LIMIT`). Optional,
     * since a view may meet a payload of a server before it (a rolling deploy, a stored result),
     * which a reader takes as none.
     */
    outsideAnyProcess?: OutsideAnyProcess
    /**
     * Root incidents raised in the last hour, the "is it burning right now?" signal; null when the
     * scan does not reach back an hour (no count tells a root from a copy in a window).
     */
    lastHourIncidents: number | null
    /** Activities with open root incidents; null unless the incident scan read every incident. */
    affectedActivities: number | null
    /** Processes with open root incidents. */
    affectedDefinitions: number
    runningInstances: number
    totalDefinitions: number
    /** Instances started in the last 24h; null when unread or the engine writes no history. */
    started24h: number | null
    /** Instances completed in the last 24h; null when unread or the engine writes no history. */
    completed24h: number | null
    /**
     * Whether the engine writes history: false at history level `none` while an instance runs,
     * where neither 24h count is known; null when nothing tells (no instance runs, a read failed).
     * Asked only when no count is above 0 and one is 0, as such an engine answers them.
     */
    historyRecorded: boolean | null
  }
  clusters: EngineHealthCluster[]
  /**
   * When the statistics it counts were read (ISO), the oldest of its reads, since the server keeps
   * them per caller for 30 seconds: rendered as "as of …" for ops trust.
   */
  fetchedAt: string
  engineId: string
}

export interface ClusterIncidentRow {
  incidentId: string
  processInstanceId: string
  /** Business key of the affected instance: the operator's "order number". */
  businessKey: string | null
  processDefinitionKey: string
  /** The process's name (the incident's definition version); null without one or unread. */
  processDefinitionName: string | null
  incidentTimestamp: string
}

/** A process a cluster lies in: its key, and its tenant where it has one. */
export interface ClusterProcess {
  processDefinitionKey: string
  tenantId?: string
}

/**
 * One cause's root incidents. Without a message filter and with no copy in the scan the counts are
 * `/incident/count` totals; otherwise an unvouched count is null.
 */
export interface ClusterDetailData extends ClusterCounts {
  activityId: string
  /** The activity's name in the newest incident's diagram; null without one or unreadable. */
  activityName: string | null
  incidentType: string
  /** Signature the result was filtered by; null = no message filter (activity+type only). */
  messageSignature: string | null
  /** Root incidents in the last hour; null when neither the scan nor a count can vouch for it. */
  lastHourCount: number | null
  /** Null unless the scan holds the whole cluster. */
  firstSeen: string | null
  latestIncident: string | null
  /** Distinct process definition keys of the scanned incidents, most-affected first. */
  processDefinitionKeys: string[]
  /**
   * The one process its scanned incidents lie in, which its View process opens: their one key, in
   * their versions' one tenant where they have one. Null where they lie in several processes,
   * name no key, or a version's tenant went unread.
   */
  process: ClusterProcess | null
  representativeMessage: string | null
  /** Most recent first. */
  incidents: ClusterIncidentRow[]
  /** The list's total: the scanned incidents after the business-key search (may exceed `incidents.length`). */
  totalMatching: number
  fetchedAt: string
  engineId: string
}
