/**
 * The process flow's view models (`engine_activity_statistics_data`): what runs at each element of
 * one process now ("Running") and what the instances started in a window passed there
 * ("Throughput"), a process being a key in one tenant.
 */

/**
 * One element of a process right now, summed over every version of the process, as the shared
 * process screen counts a version's elements (its badges).
 */
export interface ActivityStatisticsActivity {
  activityId: string
  /** Its name in the drawn diagram; null when the diagram does not name it or is unreadable. */
  activityName: string | null
  /** False when only older versions have it, so the drawn diagram cannot show it; null when the diagram is unreadable. */
  inDiagram: boolean | null
  /** Tokens at the element now, without those a root incident raised there holds. */
  running: number
  /** Jobs there with no retries left. */
  failedJobs: number
  /** Open root incidents raised there, every type. */
  incidents: number
  /**
   * Open incidents of the instances a call activity called (the copies it holds of their root
   * incidents): shown apart and quiet, never part of the incident count.
   */
  incidentsInCalledInstances: number
}

/**
 * What runs at each element of a process now (engine_activity_statistics_data): every deployed
 * version of the process (a key in one tenant) is read and summed per element, drawn on its latest
 * version's diagram.
 */
export interface ActivityStatisticsData {
  processDefinitionKey: string
  /** The process's tenant, where it has one. */
  tenantId?: string
  source: "runtime"
  /** The version the elements are drawn on: the process's latest, as the process view's. */
  diagramDefinitionId: string | null
  diagramVersion: number
  /** Deployed versions of the process, every one read: the version scope the counts name. */
  versionCount: number
  /** Elements with anything there, most running first. */
  activities: ActivityStatisticsActivity[]
  engineId: string
}

export interface ActivityThroughputActivity {
  activityId: string
  /** Its name in the drawn diagram; null when the diagram does not name it or is unreadable. */
  activityName: string | null
  /** False when only older versions have it, so the drawn diagram cannot show it; null when the diagram is unreadable. */
  inDiagram: boolean | null
  /** The window's instances' finished activity instances there (canceled included): the heat. */
  passed: number
  /** Their activity instances still open there. */
  running: number
  /** Of the finished, the canceled ones. */
  canceled: number
}

/**
 * What the instances started in the window passed at each element (engine_activity_statistics_data,
 * `source: "history"`): a cohort, so an instance started before the window counts nowhere, read
 * from the engine's history per version that started any, summed onto the latest diagram.
 */
export interface ActivityThroughputData {
  processDefinitionKey: string
  /** The process's tenant, where it has one. */
  tenantId?: string
  source: "history"
  /** The version the elements are drawn on: the process's latest, as the process view's. */
  diagramDefinitionId: string | null
  diagramVersion: number
  /** Deployed versions of the process. */
  versionCount: number
  /** The versions that started an instance in the window: the version scope the counts name. */
  versionsRead: number
  /** The window's start (ISO), on the hour; now when the window has 0 days. */
  startedAfter: string
  /**
   * The window in days: 30, or the shorter history time to live of a version that ran in it or
   * could have (deployed since its start, or the latest then); 0: the engine keeps no history of
   * the process, and nothing was read.
   */
  windowDays: number
  /** True when a version's history time to live cut the window below 30 days. */
  cappedByHistoryTimeToLive: boolean
  /** Instances started in the window, over the versions read. */
  instanceCount: number
  /**
   * The process's instances started in the window on no version read: older versions past the
   * counted ones, or history a deleted deployment left. Not in any figure; the view says how many.
   */
  uncountedInstances: number
  /** False: the engine writes no history; null: unknown. Asked only when the window holds no instance. */
  historyRecorded: boolean | null
  /** When the engine was read (ISO): the server answers from that read for up to an hour. */
  readAt: string
  /** Elements the window's instances passed, most passed first. */
  activities: ActivityThroughputActivity[]
  engineId: string
}
