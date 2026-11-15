/**
 * The operations each composite and the reads of `./runtime` may send, by operation id: the
 * contract with a port adapter that maps operations one by one (the engine connector holds its
 * table equal to the union), and the list `CORE_ROUTES` holds the route of
 * (scripts/generate-routes.ts picks them from the table).
 */

/** `inspectInstance`: the selection reads, the rounds of the instance view and its root causes. */
export const INSPECT_OPERATIONS = [
  "getHistoricProcessInstances",
  "getProcessInstances",
  "getProcessInstance",
  "getHistoricProcessInstance",
  "getActivityInstanceTree",
  "getIncidents",
  "getEventSubscriptions",
  "getTasks",
  "getExternalTasks",
  "getJobs",
  "getProcessDefinitions",
  "getJobDefinitions",
  "getProcessInstanceVariables",
  "getHistoricVariableInstances",
  "getHistoricActivityInstances",
  "getHistoricIncidents",
  "getStacktrace",
  "getExternalTaskErrorDetails",
] as const

/** `readStatus`: round one and the root cause of each incident group shown. */
export const STATUS_OPERATIONS = [
  "getRestAPIVersion",
  "getProcessDefinitionStatistics",
  "getIncidents",
  "getIncidentsCount",
  "getExternalTasks",
  "getExternalTasksCount",
  "getJobsCount",
  "getJobs",
  "getTasksCount",
  "getBatchStatistics",
  "getStacktrace",
  "getExternalTaskErrorDetails",
] as const

/** `measure`: the counts a wait's conditions and its incident check read over the instance tree. */
export const CONDITION_OPERATIONS = [
  "getProcessInstancesCount",
  "getHistoricActivityInstancesCount",
  "getJobsCount",
  "getTasksCount",
] as const

/**
 * "With incident" (`with-incident.ts`): the instances with an open incident in a scope, their count,
 * the flag of listed ids, and whether the history recorded the open incidents.
 */
export const WITH_INCIDENT_OPERATIONS = [
  "getProcessInstances",
  "getProcessInstancesCount",
  "getIncidentsCount",
  "getHistoricIncidents",
] as const

/**
 * The reads of the engine contract (`./runtime`): what the engine is, its processes and their
 * versions with "with incident", a version's diagram, the counts on it and the processes it calls,
 * the history's instances and their count with the runtime's "with incident", a version's variable
 * names, the open incidents and an incident with the text of its cause, an instance's detail (the
 * rounds of the instance view without history, its path, its typed variables), a batch from its
 * statistics or its history with its failed jobs, and a migration plan the engine generates and
 * validates.
 */
export const RUNTIME_OPERATIONS = [
  "getTelemetryData",
  "getRestAPIVersion",
  "getProcessDefinitionStatistics",
  "getProcessInstances",
  "getProcessInstancesCount",
  "getProcessDefinitionBpmn20Xml",
  "getActivityStatistics",
  "getIncidents",
  "getIncident",
  "getStacktrace",
  "getExternalTaskErrorDetails",
  "queryHistoricProcessInstances",
  "queryHistoricProcessInstancesCount",
  "queryHistoricVariableInstances",
  "getProcessInstance",
  "getHistoricProcessInstance",
  "getActivityInstanceTree",
  "getEventSubscriptions",
  "getTasks",
  "getExternalTasks",
  "getJobs",
  "getProcessDefinitions",
  "getJobDefinitions",
  "getProcessInstanceVariables",
  "getHistoricVariableInstances",
  "getHistoricActivityInstances",
  "getVariableInstances",
  "getBatchStatistics",
  "getHistoricBatch",
  "generateMigrationPlan",
  "validateMigrationPlan",
] as const

/** Every operation c7-core sends, once each, in code unit order: all of them read. */
export const CORE_OPERATIONS: readonly string[] = [
  ...new Set<string>([
    ...INSPECT_OPERATIONS,
    ...STATUS_OPERATIONS,
    ...CONDITION_OPERATIONS,
    ...WITH_INCIDENT_OPERATIONS,
    ...RUNTIME_OPERATIONS,
  ]),
].sort()
