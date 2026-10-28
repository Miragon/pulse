/** What the widgets render, not engine API types (those live in `@miragon/pulse-camunda7-client/types`). */
import type { IncidentsDashboardFilters, JobsFilters } from "./feed-contracts.js"

export interface IncidentStat {
  incidentType: string
  incidentCount: number
}

/** Counts span all versions: old versions keep running after a redeploy. */
export interface DefinitionStat {
  /** Id of the latest version — the row's link target. */
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

export type TaskFormFieldSource = "form-data" | "manual"

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
  /** The task's own form (embedded/external/Camunda Form) — set only without form fields. */
  formKey?: string
  /** Key of a Camunda Form the task links (`camunda:formRef`) — set only without form fields or formKey. */
  formRef?: string
}

export interface OpenUserTask extends TaskData {
  /** Null when the BPMN was unreadable: the form loads via `camunda7_get_task_form`, never as "no form". */
  formSchema: TaskFormSchema | null
}

export interface TaskDashboardData {
  tasks: TaskData[]
  totalCount: number
  filters: {
    assignee?: string
    candidateGroup?: string
    processDefinitionKey?: string
  }
  engineId?: string
}

export interface Job {
  id: string
  processInstanceId: string
  processDefinitionKey: string | null
  processDefinitionId: string | null
  /** The process's name (the job's definition version) — null without one or unread. */
  processDefinitionName: string | null
  activityId: string | null
  /** The failing activity's name in the job's diagram — null without one or unread. */
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
  /** Standalone renders get only `data`, so loadMore/search rebuild the feed args from this echo. */
  filters: JobsFilters
  engineId?: string
}

export interface ActivityStat {
  id: string
  instances: number
  failedJobs: number
}

export interface BpmnViewerData {
  /** Null when unreadable; `BpmnDiagram` reads the XML by this id from `camunda7_bpmn_xml_data`. */
  diagramDefinitionId: string | null
  processInstanceId: string | null
  /** The instance's business key — null for a definition target or an instance without one. */
  businessKey: string | null
  processDefinitionId: string | null
  /** The process's name from its diagram (the view's title) — null when unnamed or unreadable. */
  processDefinitionName: string | null
  activeActivityIds: string[]
  incidentActivityIds: string[]
  /** Per-activity token and failed-job counts, scoped by {@link statsScope}. */
  activityStats: ActivityStat[]
  /** `"definition"`: every running instance of the rendered version. */
  statsScope: "instance" | "definition"
  engineId?: string
}

export interface ProcessDefinition {
  id: string
  key: string
  name: string | null
  version: number
  deploymentId: string | null
  suspended: boolean
  versionTag: string | null
  tenantId: string | null
}

export interface ProcessListData {
  definitions: ProcessDefinition[]
  totalCount: number
  /** Echo for loadMore/search: a page 2 without `latestVersion` would mix all versions into a latest-only list. */
  filters: {
    processDefinitionKey?: string
    nameLike?: string
    latestVersion: boolean
  }
  engineId?: string
}

export interface ProcessInstanceRow {
  id: string
  businessKey: string | null
  /** Resolved, never parsed from a generated definition id (long keys): null when unresolvable. */
  processDefinitionKey: string | null
  /** The name of the definition this instance runs on — null without one or unread. */
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

/** The app threads the chosen `engineId` into every nested call, so navigation ignores the saved default. */
export interface CockpitAppData {
  /** Resolved engine id, or null when the user must pick (multiple engines, none selected). */
  engineId: string | null
  engines: CockpitEngineInfo[]
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

/** The engine contract's `incidentRecovery`; `none`: propagated from a called instance, cleared at its root cause. */
export type IncidentRecovery =
  | { action: "resolve" }
  | { action: "retry-job"; jobId: string }
  | { action: "retry-external-task"; externalTaskId: string }
  | { action: "none" }

export interface IncidentInstance {
  id: string
  processInstanceId: string
  /** The instance's business key — what the row names it by (else its short id); null without one or unread. */
  businessKey: string | null
  incidentType: string
  incidentMessage: string | null
  incidentTimestamp: string
  /** Optional: an older stored result reaches the view as is (reopened conversation). Read via `recoveryOf`. */
  recovery?: IncidentRecovery
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
  /** The process's name, from the instance's diagram — null without one or unreadable. */
  processDefinitionName: string | null
  /** Null for a generated id (long keys); the timeline's analytics hand-offs are omitted then. */
  definitionKey: string | null
  activityTree: ActivityTree | null
  variables: Record<string, VariableValue>
  /** The instance's open incidents (capped list; the total is `incidentCount`). */
  incidents: IncidentInstance[]
  incidentCount: number
  /** Null when unreadable; `BpmnDiagram` reads the XML by this id from `camunda7_bpmn_xml_data`. */
  diagramDefinitionId: string | null
  activeActivityIds: string[]
  incidentActivityIds: string[]
  /** The instance's open user tasks (capped list; the total is `openTaskCount`). */
  openTasks: OpenUserTask[]
  openTaskCount: number
  engineId?: string
}

export interface DeploymentResource {
  id: string
  name: string
}

export interface Deployment {
  id: string
  name: string | null
  deploymentTime: string
  source: string | null
  tenantId: string | null
  resources: DeploymentResource[]
}

export interface DeploymentBrowserData {
  totalCount: number
  deployments: Deployment[]
  engineId?: string
}

export interface ActivityData {
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

export interface HistoricProcessInstance {
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
  /** Activities with an open incident on this instance — the timeline marks them; null when unread. */
  incidentActivityIds: string[] | null
  engineId?: string
}

/** From the newest-first recency scan: facts it cannot vouch for are null, never a guess. */
export interface IncidentActivityFacts {
  activityId: string
  /** Display name from the diagram — null without one (or for an activity only older versions have). */
  activityName: string | null
  /** Newest scanned failure message — null when the activity's incidents lie beyond the scan. */
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

/** One process definition KEY with open incidents — every count spans all versions. */
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
export type EngineVendorInfo = { engineVendor: string }

export interface IncidentsDashboardData extends EngineVendorInfo {
  totalCount: number
  processCount: number
  /** Null unless every card's breakdown is complete. */
  affectedActivityCount: number | null
  last24hCount: number
  latestIncident: string | null
  processes: IncidentsDashboardProcess[]
  /** Standalone renders never refetch, so hand-offs read the scope here: a filtered total is not the engine's. */
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

/** One page of an activity's incident rows (camunda7_activity_incidents_data). */
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
  /** Null when unreadable; `BpmnDiagram` reads the XML by this id from `camunda7_bpmn_xml_data`. */
  diagramDefinitionId: string | null
  cockpitUrl: string | null
  runningInstances: number
  incidentCount: number
  last24hCount: number
  /** Jobs with no retries left, over every version of the key. */
  failedJobs: number
  /** Activities in the diagram — null when the diagram is unavailable. */
  totalActivityCount: number | null
  /** Numerator of `totalActivityCount`; `activities` may hold more (only older versions have them). */
  affectedDiagramActivityCount: number | null
  latestIncident: string | null
  activities: ProcessIncidentsActivity[]
  /** Read only for the empty state, to jump to where incidents are; null when not read. */
  siblingsWithIncidents: IncidentsByProcess[] | null
  engineId?: string
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

  /** Null when unreadable; `BpmnDiagram` reads the XML by this id from `camunda7_bpmn_xml_data`. */
  diagramDefinitionId: string | null

  // Null for external-task incidents
  job: IncidentDetailJob | null
  /** Optional like {@link IncidentInstance.recovery}: read it through `recoveryOf`. */
  recovery?: IncidentRecovery

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
