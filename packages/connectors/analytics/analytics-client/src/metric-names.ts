// Hand-maintained, not imported: metrics-contract.json lies outside the tsconfig `rootDir`.
export const METRIC_NAMES = {
  processInstanceStarted: "engine_process_instance_started_total",
  processInstanceEnded: "engine_process_instance_ended_total",
  activityEnded: "engine_activity_ended_total",
  userTaskCreated: "engine_usertask_created_total",
  userTaskCompleted: "engine_usertask_completed_total",
  incidentCreated: "engine_incident_created_total",
  incidentResolved: "engine_incident_resolved_total",
  processInstanceDuration: "engine_process_instance_duration_milliseconds",
  activityDuration: "engine_activity_duration_milliseconds",
  userTaskDuration: "engine_usertask_duration_milliseconds",
  processInstancesRunning: "engine_process_instances_running",
  jobsFailed: "engine_jobs_failed",
  incidentsOpen: "engine_incidents_open",
  jobsExecutable: "engine_jobs_executable",
  jobsSuspended: "engine_jobs_suspended",
  jobsDueFuture: "engine_jobs_due_future",
  userTasksOpen: "engine_usertasks_open",
  processDefinitionsDeployed: "engine_process_definitions_deployed",
  externalTasksOpen: "engine_external_tasks_open",
} as const

export type GaugeName =
  | typeof METRIC_NAMES.processInstancesRunning
  | typeof METRIC_NAMES.jobsFailed
  | typeof METRIC_NAMES.incidentsOpen
  | typeof METRIC_NAMES.jobsExecutable
  | typeof METRIC_NAMES.jobsSuspended
  | typeof METRIC_NAMES.jobsDueFuture
  | typeof METRIC_NAMES.userTasksOpen
  | typeof METRIC_NAMES.processDefinitionsDeployed
  | typeof METRIC_NAMES.externalTasksOpen

export const GAUGE_LABELS: Readonly<Record<GaugeName, readonly string[]>> = {
  [METRIC_NAMES.processInstancesRunning]: ["process_definition_key", "engine_id"],
  [METRIC_NAMES.jobsFailed]: ["process_definition_key", "engine_id"],
  [METRIC_NAMES.incidentsOpen]: ["process_definition_key", "incident_type", "engine_id"],
  [METRIC_NAMES.jobsExecutable]: ["engine_id"],
  [METRIC_NAMES.jobsSuspended]: ["engine_id"],
  [METRIC_NAMES.jobsDueFuture]: ["engine_id"],
  [METRIC_NAMES.userTasksOpen]: ["status", "engine_id"],
  [METRIC_NAMES.processDefinitionsDeployed]: ["process_definition_key", "engine_id"],
  [METRIC_NAMES.externalTasksOpen]: ["engine_id"],
}
