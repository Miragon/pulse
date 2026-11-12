/**
 * The operations each composite may send, by operation id: the contract with a port adapter that
 * maps operations one by one (the engine connector holds its table equal to the union), and the
 * list `CORE_ROUTES` holds the route of (scripts/generate-routes.ts picks them from the table).
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

/** Every operation c7-core sends, once each, in code unit order: all of them read. */
export const CORE_OPERATIONS: readonly string[] = [
  ...new Set<string>([...INSPECT_OPERATIONS, ...STATUS_OPERATIONS, ...CONDITION_OPERATIONS]),
].sort()
