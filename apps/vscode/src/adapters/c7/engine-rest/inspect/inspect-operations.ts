interface RestOperation {
  readonly path: string
  readonly text?: true
}

export interface RestRequest {
  readonly path: string
  readonly text: boolean
}

const PATH_ARGUMENT = "{}"

const OPERATIONS: ReadonlyMap<string, RestOperation> = new Map<string, RestOperation>([
  ["getHistoricProcessInstances", { path: "/history/process-instance" }],
  ["getProcessInstances", { path: "/process-instance" }],
  ["getProcessInstance", { path: "/process-instance/{}" }],
  ["getHistoricProcessInstance", { path: "/history/process-instance/{}" }],
  ["getActivityInstanceTree", { path: "/process-instance/{}/activity-instances" }],
  ["getIncidents", { path: "/incident" }],
  ["getEventSubscriptions", { path: "/event-subscription" }],
  ["getTasks", { path: "/task" }],
  ["getExternalTasks", { path: "/external-task" }],
  ["getJobs", { path: "/job" }],
  ["getProcessDefinitions", { path: "/process-definition" }],
  ["getJobDefinitions", { path: "/job-definition" }],
  ["getProcessInstanceVariables", { path: "/process-instance/{}/variables" }],
  ["getHistoricVariableInstances", { path: "/history/variable-instance" }],
  ["getHistoricActivityInstances", { path: "/history/activity-instance" }],
  ["getHistoricIncidents", { path: "/history/incident" }],
  ["getStacktrace", { path: "/job/{}/stacktrace", text: true }],
  ["getExternalTaskErrorDetails", { path: "/external-task/{}/errorDetails", text: true }],
])

export class InspectOperations {
  static ids(): string[] {
    return [...OPERATIONS.keys()]
  }

  static requestOf(operationId: string, pathArgs: readonly string[]): RestRequest {
    const operation = OPERATIONS.get(operationId)
    if (operation === undefined) {
      throw new RangeError(`The inspection has no REST path for the operation ${operationId}`)
    }
    const [head = "", ...rest] = operation.path.split(PATH_ARGUMENT)
    const path = rest.reduce(
      (built, part, index) => `${built}${encodeURIComponent(pathArgs[index] ?? "")}${part}`,
      head,
    )
    return { path, text: operation.text === true }
  }
}
