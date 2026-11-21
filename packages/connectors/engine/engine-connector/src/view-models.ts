/** What the widgets render, not engine API types (those live in `@miragon/pulse-c7-client/types`). */
import type { IncidentRecovery } from "@miragon/pulse-c7-core"
import type { IncidentsDashboardFilters } from "./feed-contracts.js"
import type { BoardStartData, LandingStartData } from "./view-models.board.js"
import type { ClusterDetailData, EngineHealthData } from "./view-models.health.js"
import type { JobPanelData } from "./view-models.jobs.js"
import type {
  IncidentDetailExternalTask,
  IncidentDetailJob,
  IncidentDetailRootCause,
  IncidentRootCause,
} from "./view-models.incidents.js"

/**
 * Page sizes the server and the widgets share: the start view is built with the size its widget
 * pages by, so the seed is always that widget's page 0.
 */
export const LIST_PAGE_SIZE = 50
export const HISTORY_PAGE_SIZE = 100

/** Counts span all versions: old versions keep running after a redeploy. */
export interface DefinitionStat {
  /** Id of the latest version, the row's link target. */
  id: string
  key: string
  name: string | null
  latestVersion: number
  instances: number
  failedJobs: number
  /**
   * Open root incidents by type: a call activity's copy of a called instance's incident counts in
   * the called process, never here.
   */
  incidents: Array<{ incidentType: string; incidentCount: number }>
}

export interface CockpitDashboardData {
  summary: {
    /** Deployed definition KEYS (not versions). */
    totalDefinitions: number
    totalRunningInstances: number
    totalFailedJobs: number
    /** Open root incidents of every process. */
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
  /** When the instance started, from the history (enrichment): null when unread or unrecorded. */
  startTime: string | null
}

/**
 * The API family an engine speaks: `c7` the Camunda 7 REST API every route of the cockpit reads,
 * `c8` Camunda 8's Orchestration Cluster REST API, which the server reads on boards only.
 */
export type EngineDialect = "c7" | "c8"

export interface CockpitEngineInfo {
  id: string
  /** Environment grouping for the two-stage picker (default environment when unconfigured). */
  environment: string
  /**
   * The dialect it speaks; absent on a refused profile, which no call reaches. Every route reads a
   * `c7` engine. Another dialect's engine the cockpit shows on boards only: each of its routes is
   * one state that reads nothing (`BoardsOnlyEngineGate`), its landing row reads nothing either.
   */
  dialect?: EngineDialect
  /**
   * Another dialect's: its web app (Operate on Camunda 8) from the profile's `cockpitUrl` as
   * written, http(s) only, never derived from the engine's `url`; absent without one.
   */
  webAppUrl?: string
  /** Another dialect's: the ids of the configured boards that name it, in the board files' order. */
  boards?: readonly string[]
  /**
   * Its profile refused, and why (the server's reason, which names keys only, never a value): its
   * row and card say so without a read, its view is that one state, which reads nothing either.
   */
  refused?: { readonly reason: string }
}

/**
 * Where the cockpit is: one route per section, with the ids that route reads. A board (`board`)
 * and the landing (`landing`) are app-level routes (`AppSection`): a board reads the engines its
 * file names, the landing lists the engines and the server's boards, never one engine of the
 * cockpit.
 */
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
  | { section: "board"; board: string; label?: string }
  | { section: "landing" }

export type CockpitSection = CockpitView["section"]

/**
 * The sections of the app's own routes, which open no engine of the cockpit: a board reads the
 * engines its file names, the landing lists the engines and the server's boards.
 */
export type AppSection = "board" | "landing"

/** The overview's two widgets: the health verdict and the definitions table. */
interface CockpitOverviewData {
  health: EngineHealthData
  definitions: CockpitDashboardData
}

/**
 * Each route's data: exactly the payload its `*_data` feed returns for the route's first page; the
 * landing's, which has no feed of its own, the boards the engine list names.
 */
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
  board: BoardStartData
  landing: LandingStartData
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
  /**
   * Resolved engine id, or null when the user must pick (multiple engines, none selected) and on
   * an app route: a board, which reads the engines it names, and the landing.
   */
  engineId: string | null
  engines: CockpitEngineInfo[]
  /**
   * Where the cockpit opens, with that view's data; null exactly on the engine picker of a call
   * that named no view and resolved no engine, and on a page's start that failed (`startView`).
   */
  start: CockpitStart | null
  /**
   * Where a page opens the cockpit after its start of one engine's view failed for that engine
   * (`cockpitAfterFailedStart` of the widgets): the view without its data, which its route reads
   * itself, so the cockpit keeps its head over the failure. The server sends none.
   */
  startView?: CockpitView
}

export interface ProcessInstancesData {
  /** Null → the engine-wide list (no definition scope). */
  processDefinitionKey: string | null
  processDefinitionName: string | null
  /** Total matching instances on the engine (may exceed `instances.length`). */
  totalCount: number
  returnedCount: number
  /**
   * The All chip's count: every instance in the scope and search, no chip filter (the whole set,
   * not the page), whichever chip is on.
   */
  allCount: number
  /** The With incident chip's count: instances with an open incident in the scope and search. */
  withIncidentCount: number
  /** The Suspended chip's count: suspended instances in the scope and search, whichever chip is on. */
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
  /** When the page and its counts were read (ISO timestamp): the view's "As of". */
  fetchedAt: string
  engineId?: string
}

export interface VariableValue {
  value: unknown
  type?: string
  valueInfo?: Record<string, unknown>
}

/** c7-core's `incidentRecovery`; `none`: propagated from a called instance, cleared at its root cause. */
export type { IncidentRecovery }

export interface IncidentInstance {
  id: string
  processInstanceId: string
  /** The instance's business key, what the row names it by (else its short id); null without one or unread. */
  businessKey: string | null
  incidentType: string
  incidentMessage: string | null
  incidentTimestamp: string
  /** The element the incident occurred at; null when the engine names none. */
  activityId: string | null
  /**
   * The element's name in the instance's diagram; null without one or unread (an activity's
   * incident page leaves it null: its group names the activity).
   */
  activityName: string | null
  recovery: IncidentRecovery
  /** Null without cockpitUrl or when scheme validation rejected it. */
  cockpitInstanceUrl: string | null
  /**
   * The root incident a copy of a called instance's incident stands for (`rootIdOfCopy`), which its
   * row opens; absent or null on a root incident.
   */
  rootIncidentId?: string | null
  /** A copy's root incident in a called instance; absent or null otherwise and where unread. */
  rootCause?: IncidentRootCause | null
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
  /**
   * The key the definition id names, resolved for a bare generated id (long keys); null when
   * that read fails (enrichment: no drill to the process, never the UUID as a key).
   */
  definitionKey: string | null
  activityTree: ActivityTree | null
  variables: Record<string, VariableValue>
  /**
   * The instance that called this one at a call activity, from the history (as the webview reads
   * it); null for an instance nothing called, and unread (history level none, a failed read).
   */
  callerInstanceId: string | null
  /** When the instance started, from the history; null unread (history level none, a failed read). */
  startTime: string | null
  /**
   * The instance's open incidents (capped list; the total is `incidentCount`): its own root
   * incidents and, at a call activity, a copy for each root incident of the instances it called,
   * which leads on to that root (`rootCause`).
   */
  incidents: IncidentInstance[]
  /**
   * Its open incidents, a copy at a call activity included: one per root incident of its tree (its
   * own and those of the instances it called), so the root incidents of its tree.
   */
  incidentCount: number
  /** Null when unreadable; `BpmnDiagram` reads the XML by this id from `engine_bpmn_xml_data`. */
  diagramDefinitionId: string | null
  activeActivityIds: string[]
  incidentActivityIds: string[]
  /** The instance's open user tasks (capped list; the total is `openTaskCount`). */
  openTasks: OpenUserTask[]
  openTaskCount: number
  /** When the server read the instance (ISO), for its bar's "As of"; absent in an older payload. */
  fetchedAt?: string
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
  /** The engine's row carries it; the history route's title names the instance by it. */
  businessKey?: string | null
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
  /** When the server read the history (ISO), for its bar's "As of"; absent in an older payload. */
  fetchedAt?: string
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

/**
 * One activity and incident type of a process, the scope of its failure cluster (the cluster view
 * it opens): its root incidents. Its name comes from the diagram of its newest incident's version,
 * and its message is that incident's.
 */
export interface IncidentsDashboardActivity extends IncidentActivityFacts {
  incidentType: string
  /** This activity's root incidents within the scan (exact when the card is fully scanned). */
  scannedIncidentCount: number
}

/**
 * One process definition KEY with open root incidents. Every count spans all versions; a call
 * activity's copy of a called instance's incident counts in the called process.
 */
export interface IncidentsDashboardProcess {
  processDefinitionKey: string
  processDefinitionName: string | null
  latestVersion: number
  runningInstances: number
  /** Exact open root incidents of the key (definition statistics, `rootIncidents=true`). */
  incidentCount: number
  /** How many of `incidentCount` the per-activity breakdown covers (the recency scan's share). */
  scannedIncidentCount: number
  /** Distinct activities; null unless the breakdown covers every root incident of the key. */
  affectedActivityCount: number | null
  /** Null when none of the key's root incidents is within the scan. */
  latestIncident: string | null
  cockpitUrl: string | null
  activities: IncidentsDashboardActivity[]
}

/** `provider.branding.displayName`; names the link into the engine's web app, never this app's "Cockpit". */
type EngineVendorInfo = { engineVendor: string }

export interface IncidentsDashboardData extends EngineVendorInfo {
  /** The open root incidents of the processes shown, their cards' sum. */
  totalCount: number
  processCount: number
  /** Null unless every card's breakdown is complete. */
  affectedActivityCount: number | null
  latestIncident: string | null
  processes: IncidentsDashboardProcess[]
  /** Hand-offs read the scope here: a filtered total is not the engine's. */
  filters: IncidentsDashboardFilters
  /** When the counts were read (ISO timestamp): the view's "As of". */
  fetchedAt: string
  engineId?: string
}

export interface IncidentsByProcess {
  processDefinitionKey: string
  processDefinitionName: string | null
  incidentCount: number
}

export interface ProcessIncidentsActivity extends IncidentActivityFacts {
  /** Exact open root incidents raised at this activity over every version of the key. */
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

/**
 * Counts span all versions; only the diagram is one (`diagramVersion`, latest over every tenant).
 * Its incidents are open root incidents: a call activity's copy of a called instance's incident
 * counts in the called process.
 */
export interface ProcessIncidentsData extends EngineVendorInfo {
  processDefinitionKey: string
  processDefinitionName: string | null
  diagramVersion: number
  /** Null when unreadable; `BpmnDiagram` reads the XML by this id from `engine_bpmn_xml_data`. */
  diagramDefinitionId: string | null
  cockpitUrl: string | null
  runningInstances: number
  /** Open root incidents of the key (definition statistics, `rootIncidents=true`). */
  incidentCount: number
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
  /** When the server read these numbers (ISO), for the view's "As of"; absent in an older payload. */
  fetchedAt?: string
  engineId?: string
}

/**
 * One element of a process right now, summed over every version of its key, as the shared process
 * screen counts a version's elements (its badges).
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
  /** The failed external task of a `failedExternalTask` incident, null for every other. */
  externalTask: IncidentDetailExternalTask | null
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

  /**
   * A delegated incident's root cause (a copy at a call activity): the failure in a called
   * instance, by its element and its process; null for a root incident. Its names are enrichment.
   */
  rootCause: IncidentDetailRootCause | null

  /** When the server read the incident (ISO), for its bar's "As of"; absent in an older payload. */
  fetchedAt?: string
  engineId?: string
}

// Re-exported so every consumer keeps one import path.
export type * from "./view-models.health.js"
export type * from "./view-models.jobs.js"
export type * from "./view-models.incidents.js"
