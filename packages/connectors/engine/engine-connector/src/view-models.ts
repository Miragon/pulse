/** What the widgets render, not engine API types (those live in `@miragon/pulse-engine-client/types`). */
import type { IncidentRecovery } from "@miragon/pulse-engine-core"
import type { IncidentsDashboardFilters, JobsFilters } from "./feed-contracts.js"
import type { ClusterDetailData, EngineHealthData } from "./view-models.health.js"

/**
 * Page sizes the server and the widgets share: the start view is built with the size its widget
 * pages by, so the seed is always that widget's page 0.
 */
export const LIST_PAGE_SIZE = 50
export const HISTORY_PAGE_SIZE = 100

interface IncidentStat {
  incidentType: string
  incidentCount: number
}

/** Counts span all versions: old versions keep running after a redeploy. */
export interface DefinitionStat {
  /** Id of the latest version, the row's link target. */
  id: string
  key: string
  name: string | null
  latestVersion: number
  instances: number
  failedJobs: number
  incidents: IncidentStat[]
}

export interface CockpitDashboardData {
  summary: {
    /** Deployed definition KEYS (not versions). */
    totalDefinitions: number
    totalRunningInstances: number
    totalFailedJobs: number
    totalIncidents: number
  }
  definitions: DefinitionStat[]
  engineId?: string
}

/**
 * One engine's job backlog right now, four counts of that engine alone: the cross-engine
 * overview compares them across engines, since no process mix is in them.
 */
export interface JobBacklogData {
  /** Jobs the job executor runs next: retries left, due and active (engine-core's `EXECUTABLE`). */
  executableJobs: number
  suspendedJobs: number
  /** Jobs due later than now: timers, and retries waiting out their back-off. */
  jobsDueLater: number
  /** External tasks waiting for a worker or locked by one. */
  externalTasks: number
  engineId: string
}

export interface TaskData {
  id: string
  name: string | null
  assignee: string | null
  created: string
  due: string | null
  priority: number
  processDefinitionId: string
  processInstanceId: string
  taskDefinitionKey: string
  description: string | null
}

type TaskFormFieldSource = "form-data" | "manual"

export interface TaskFormField {
  name: string
  type?: string
  label?: string
  defaultValue?: unknown
  suggestedValues?: unknown[]
  required?: boolean
  readonly?: boolean
  source: TaskFormFieldSource
}

export interface TaskFormSchema {
  taskId: string
  fields: TaskFormField[]
  /** The task's own form (embedded/external/Camunda Form), set only without form fields. */
  formKey?: string
  /** Key of a Camunda Form the task links (`camunda:formRef`), set only without form fields or formKey. */
  formRef?: string
}

export interface OpenUserTask extends TaskData {
  /** Null when the BPMN was unreadable: the form loads via `engine_get_task_form`, never as "no form". */
  formSchema: TaskFormSchema | null
}

interface Job {
  id: string
  processInstanceId: string
  processDefinitionKey: string | null
  processDefinitionId: string | null
  /** The process's name (the job's definition version); null without one or unread. */
  processDefinitionName: string | null
  activityId: string | null
  /** The failing activity's name in the job's diagram; null without one or unread. */
  activityName: string | null
  retries: number
  exceptionMessage: string | null
  dueDate: string | null
  suspended: boolean
  priority: number
  createTime: string | null
}

export interface JobPanelData {
  totalCount: number
  failedCount: number
  jobs: Job[]
  /** The filters the page on screen was read with; hand-offs and model contexts state its scope. */
  filters: JobsFilters
  engineId?: string
}

export interface ProcessInstanceRow {
  id: string
  businessKey: string | null
  /** Resolved, never parsed from a generated definition id (long keys): null when unresolvable. */
  processDefinitionKey: string | null
  /** The name of the definition this instance runs on; null without one or unread. */
  processDefinitionName: string | null
  version: number | null
  suspended: boolean
  hasIncident: boolean
}

export interface CockpitEngineInfo {
  id: string
  /** Environment grouping for the two-stage picker (default environment when unconfigured). */
  environment: string
}

/** Where the cockpit is: one route per section, with the ids that route reads. */
export type CockpitView =
  | { section: "overview" }
  | { section: "incidents" }
  | {
      section: "cluster-detail"
      activityId: string
      incidentType: string
      messageSignature?: string
      label?: string
    }
  | {
      section: "process-detail"
      processDefinitionKey: string
      focus?: "incidents"
      label?: string
    }
  | { section: "process-instances"; processDefinitionKey?: string }
  | { section: "instance-detail"; processInstanceId: string; label?: string }
  | { section: "incident-detail"; incidentId: string; label?: string }
  | { section: "jobs"; processDefinitionKey?: string; failedOnly?: boolean }
  | { section: "history"; processInstanceId: string }

export type CockpitSection = CockpitView["section"]

/** The overview's two widgets: the health verdict and the definitions table. */
interface CockpitOverviewData {
  health: EngineHealthData
  definitions: CockpitDashboardData
}

/** Each route's data: exactly the payload its `*_data` feed returns for the route's first page. */
export interface CockpitStartData {
  overview: CockpitOverviewData
  incidents: IncidentsDashboardData
  "cluster-detail": ClusterDetailData
  "process-detail": ProcessIncidentsData
  "process-instances": ProcessInstancesData
  "instance-detail": InstanceDetailData
  "incident-detail": IncidentDetailData
  jobs: JobPanelData
  history: HistoryTimelineData
}

/**
 * The start view of `engine_open_cockpit` and its data, one pair discriminated by the view's
 * section; the route seeds its feed with the data.
 */
export type CockpitStart = {
  [S in CockpitSection]: { view: Extract<CockpitView, { section: S }>; data: CockpitStartData[S] }
}[CockpitSection]

/** The app threads the chosen `engineId` into every nested call, so navigation ignores the default engine. */
export interface CockpitAppData {
  /** Resolved engine id, or null when the user must pick (multiple engines, none selected). */
  engineId: string | null
  engines: CockpitEngineInfo[]
  /** Where the cockpit opens, with that view's data; null exactly on the engine picker. */
  start: CockpitStart | null
}

export interface ProcessInstancesData {
  /** Null → the engine-wide list (no definition scope). */
  processDefinitionKey: string | null
  processDefinitionName: string | null
  /** Total matching instances on the engine (may exceed `instances.length`). */
  totalCount: number
  returnedCount: number
  /** Of `totalCount` (the whole filtered set, not the page): instances with an open incident. */
  withIncidentCount: number
  /** Of `totalCount` (the whole filtered set, not the page): suspended instances. */
  suspendedCount: number
  instances: ProcessInstanceRow[]
  filters: {
    active?: boolean
    suspended?: boolean
    withIncidents?: boolean
    businessKeyLike?: string
    /** The search box's term (business key fragment or whole id), when it replaced `businessKeyLike`. */
    search?: string
  }
  engineId?: string
}

export interface VariableValue {
  value: unknown
  type?: string
  valueInfo?: Record<string, unknown>
}

/** engine-core's `incidentRecovery`; `none`: propagated from a called instance, cleared at its root cause. */
export type { IncidentRecovery }

export interface IncidentInstance {
  id: string
  processInstanceId: string
  /** The instance's business key, what the row names it by (else its short id); null without one or unread. */
  businessKey: string | null
  incidentType: string
  incidentMessage: string | null
  incidentTimestamp: string
  recovery: IncidentRecovery
  /** Null without cockpitUrl or when scheme validation rejected it. */
  cockpitInstanceUrl: string | null
}

export interface ActivityTree {
  id: string
  activityId: string
  activityName: string | null
  activityType: string
  childActivityInstances: ActivityTree[]
}

export interface InstanceDetailData {
  instance: {
    id: string
    definitionId: string
    businessKey: string | null
    suspended: boolean
    ended: boolean
  }
  /** The process's name, from the instance's diagram; null without one or unreadable. */
  processDefinitionName: string | null
  /** Null for a generated id (long keys). */
  definitionKey: string | null
  activityTree: ActivityTree | null
  variables: Record<string, VariableValue>
  /** The instance's open incidents (capped list; the total is `incidentCount`). */
  incidents: IncidentInstance[]
  incidentCount: number
  /** Null when unreadable; `BpmnDiagram` reads the XML by this id from `engine_bpmn_xml_data`. */
  diagramDefinitionId: string | null
  activeActivityIds: string[]
  incidentActivityIds: string[]
  /** The instance's open user tasks (capped list; the total is `openTaskCount`). */
  openTasks: OpenUserTask[]
  openTaskCount: number
  engineId?: string
}

interface ActivityData {
  id: string
  activityId: string
  activityName: string | null
  activityType: string
  startTime: string
  endTime: string | null
  durationInMillis: number | null
  assignee: string | null
  taskId: string | null
}

interface HistoricProcessInstance {
  id: string
  processDefinitionKey: string
  processDefinitionName: string | null
  startTime: string
  endTime: string | null
  durationInMillis: number | null
  state: string
}

export interface HistoryTimelineData {
  processInstance: HistoricProcessInstance | null
  activities: ActivityData[]
  totalActivities: number
  /** Activities with an open incident on this instance, which the timeline marks; null when unread. */
  incidentActivityIds: string[] | null
  engineId?: string
}

/** From the newest-first recency scan: facts it cannot vouch for are null, never a guess. */
interface IncidentActivityFacts {
  activityId: string
  /** Display name from the diagram; null without one (or for an activity only older versions have). */
  activityName: string | null
  /** Newest scanned failure message; null when the activity's incidents lie beyond the scan. */
  representativeMessage: string | null
  /** Null unless the scan holds ALL of the activity's incidents. */
  firstSeen: string | null
  /** Null when the activity's incidents lie beyond the scan. */
  latestIncident: string | null
}

export interface IncidentsDashboardActivity extends IncidentActivityFacts {
  /** This activity's incidents within the scan (exact when the card is fully scanned). */
  scannedIncidentCount: number
  /** Incidents since now − 24h; null when the scan does not reach back that far. */
  last24hCount: number | null
}

/** One process definition KEY with open incidents. Every count spans all versions. */
export interface IncidentsDashboardProcess {
  processDefinitionKey: string
  processDefinitionName: string | null
  latestVersion: number
  runningInstances: number
  /** Exact open incidents of the key (definition statistics). */
  incidentCount: number
  /** How many of `incidentCount` the per-activity breakdown covers (the recency scan's share). */
  scannedIncidentCount: number
  /** Null unless the breakdown covers every incident of the key. */
  affectedActivityCount: number | null
  /** Null when the scan does not reach back 24h. */
  last24hCount: number | null
  /** Null when none of the key's incidents is within the scan. */
  latestIncident: string | null
  cockpitUrl: string | null
  activities: IncidentsDashboardActivity[]
}

/** `provider.branding.displayName`; names the link into the engine's web app, never this app's "Cockpit". */
type EngineVendorInfo = { engineVendor: string }

export interface IncidentsDashboardData extends EngineVendorInfo {
  totalCount: number
  processCount: number
  /** Null unless every card's breakdown is complete. */
  affectedActivityCount: number | null
  last24hCount: number
  latestIncident: string | null
  processes: IncidentsDashboardProcess[]
  /** Hand-offs read the scope here: a filtered total is not the engine's. */
  filters: IncidentsDashboardFilters
  engineId?: string
}

export interface IncidentsByProcess {
  processDefinitionKey: string
  processDefinitionName: string | null
  incidentCount: number
}

export interface ProcessIncidentsActivity extends IncidentActivityFacts {
  /** Exact open incidents of this activity over every version of the key. */
  incidentCount: number
}

/** One page of an activity's incident rows (engine_activity_incidents_data). */
export interface ActivityIncidentsData {
  processDefinitionKey: string
  activityId: string
  /** The requested page, newest first. */
  incidents: IncidentInstance[]
  /** Exact total for this activity from /incident/count. */
  totalCount: number
  engineId: string
}

/** Counts span all versions; only the diagram is one (`diagramVersion`, latest over every tenant). */
export interface ProcessIncidentsData extends EngineVendorInfo {
  processDefinitionKey: string
  processDefinitionName: string | null
  diagramVersion: number
  /** Null when unreadable; `BpmnDiagram` reads the XML by this id from `engine_bpmn_xml_data`. */
  diagramDefinitionId: string | null
  cockpitUrl: string | null
  runningInstances: number
  incidentCount: number
  last24hCount: number
  /** Jobs with no retries left, over every version of the key. */
  failedJobs: number
  /** Activities in the diagram; null when the diagram is unavailable. */
  totalActivityCount: number | null
  /** Numerator of `totalActivityCount`; `activities` may hold more (only older versions have them). */
  affectedDiagramActivityCount: number | null
  latestIncident: string | null
  activities: ProcessIncidentsActivity[]
  /** Read only for the empty state, to jump to where incidents are; null when not read. */
  siblingsWithIncidents: IncidentsByProcess[] | null
  engineId?: string
}

/** One element of a process right now, summed over every version of its key. */
export interface ActivityStatisticsActivity {
  activityId: string
  /** Its name in the drawn diagram; null when the diagram does not name it or is unreadable. */
  activityName: string | null
  /** False when only older versions have it, so the drawn diagram cannot show it; null when the diagram is unreadable. */
  inDiagram: boolean | null
  /** Activity instances at the element now (the engine's `instances`), those with an incident included. */
  running: number
  /** Jobs there with no retries left. */
  failedJobs: number
  /** Open incidents there, every type. */
  incidents: number
}

/**
 * What runs at each element of a process now (engine_activity_statistics_data): every deployed
 * version is read and summed per element, drawn on the latest version's diagram.
 */
export interface ActivityStatisticsData {
  processDefinitionKey: string
  source: "runtime"
  /** The version the elements are drawn on: the latest over every tenant, as the process view's. */
  diagramDefinitionId: string | null
  diagramVersion: number
  /** Deployed versions of the key, every one read: the version scope the counts name. */
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
  source: "history"
  /** The version the elements are drawn on: the latest over every tenant, as the process view's. */
  diagramDefinitionId: string | null
  diagramVersion: number
  /** Deployed versions of the key. */
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
   * The key's instances started in the window on no version read: older versions past the counted
   * ones, or history a deleted deployment left. Not in any figure; the view says how many.
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

export interface IncidentDetailJob {
  id: string
  retries: number
  exceptionMessage: string | null
  /** Null when the engine rejected it or the incident is not job-backed. */
  stacktrace: string | null
  dueDate: string | null
}

export interface IncidentDetailData extends EngineVendorInfo {
  incidentId: string
  incidentType: string
  incidentMessage: string | null
  incidentTimestamp: string
  activityId: string
  activityName: string | null

  processDefinitionKey: string
  processDefinitionId: string
  processDefinitionName: string | null
  processDefinitionVersion: number | null
  processInstanceId: string
  businessKey: string | null
  cockpitInstanceUrl: string | null

  /** Null when unreadable; `BpmnDiagram` reads the XML by this id from `engine_bpmn_xml_data`. */
  diagramDefinitionId: string | null

  // Null for external-task incidents
  job: IncidentDetailJob | null
  recovery: IncidentRecovery

  instance: {
    id: string
    definitionId: string
    businessKey: string | null
    suspended: boolean
    ended: boolean
  }
  activityTree: ActivityTree | null
  variables: Record<string, VariableValue>

  /** Null on history level "none"; the History tab pages rows itself. */
  historyTotalCount: number | null

  engineId?: string
}

// Re-exported so every consumer keeps one import path.
export type * from "./view-models.health.js"
