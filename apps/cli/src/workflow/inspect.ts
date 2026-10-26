/**
 * `pulse-cli inspect`: where a process instance waits and why. Loads the rounds of
 * requests (instance, tree, wait states, root causes) and assembles the instance view.
 */

import type { EnginePort, PlannedRequest } from "../engine-port/engine-port.js"
import { PulseCliError } from "../errors.js"
import { compact, isRecord, mapLimit } from "../util.js"
import { isMissing, json, listByIds, PARALLEL } from "./engine.js"
import { field, type Rec, records, str } from "./records.js"
import { rootCause } from "./root-cause.js"
import { checkSelection, type Selection, selectInstance, selectionRequests } from "./select.js"
import { instanceView, rootIncidents } from "./snapshot.js"
import { activeTree } from "./tree.js"
import type {
  EndedInstance,
  IncidentCause,
  InstanceData,
  InstanceView,
  WorkflowResult,
} from "./types.js"
import { historicVariableMap } from "./variables.js"

export interface InspectOptions {
  readonly variables: boolean
  readonly history: boolean
  readonly stacktrace: boolean
}

/** Root causes are loaded for at most this many incidents per command run. */
const MAX_CAUSES = 10
const MAX_STACKTRACE_LINES = 200
const NO_VALUES = { deserializeValues: "false" }
const JOBS = { operationId: "getJobs", key: "processInstanceIds" }
/** The request that holds the root cause of an incident type. */
const CAUSE_OPERATIONS: ReadonlyMap<string, string> = new Map([
  ["failedJob", "getStacktrace"],
  ["failedExternalTask", "getExternalTaskErrorDetails"],
])

function idInput(id: string) {
  return { pathArgs: [id], query: {} }
}

/** The first round for an id: runtime and history record. */
export function instanceRequests(id: string): PlannedRequest[] {
  return [
    { operationId: "getProcessInstance", input: idInput(id) },
    { operationId: "getHistoricProcessInstance", input: idInput(id) },
  ]
}

/** NOT_FOUND for an id that neither the runtime nor the history knows. */
export function instanceMissing(id: string): PulseCliError {
  return new PulseCliError(
    "NOT_FOUND",
    `Process instance ${id} does not exist (neither running nor in the history)`,
    {
      hint: "List instances with `pulse-cli process-instance list` (running) or `pulse-cli historic-process-instance list` (also ended); with history level none, ended instances cannot be found.",
    },
  )
}

async function timeline(port: EnginePort, id: string) {
  const [activities, incidents] = await Promise.all([
    port.list("getHistoricActivityInstances", {
      processInstanceId: id,
      sortBy: "occurrence",
      sortOrder: "asc",
    }),
    port.list("getHistoricIncidents", { processInstanceId: id }),
  ])
  return { timeline: activities.items, historicIncidents: incidents.items }
}

function emptyData(id: string, options: InspectOptions): InstanceData {
  return {
    id,
    tree: [],
    truncated: false,
    activityTrees: [],
    incidents: [],
    subscriptions: [],
    tasks: [],
    externalTasks: [],
    jobs: [],
    timerJobIds: new Set(),
    definitions: [],
    jobDefinitions: [],
    causes: new Map(),
    historyRequested: options.history,
  }
}

async function endedData(port: EnginePort, id: string, history: Rec, options: InspectOptions) {
  const [variables, past] = await Promise.all([
    options.variables
      ? port.list("getHistoricVariableInstances", { processInstanceId: id, ...NO_VALUES })
      : undefined,
    options.history ? timeline(port, id) : undefined,
  ])
  return {
    ...emptyData(id, options),
    history,
    ...compact({ variables: variables && historicVariableMap(variables.items, id) }),
    ...past,
  }
}

/**
 * The instance ended between two rounds (a job executor finished it): its activity instances
 * answer 404, its variables 500 NullValueException (verified on all three engines).
 */
function endedMeanwhile(error: unknown): boolean {
  if (isMissing(error)) return true
  return (
    error instanceof PulseCliError &&
    error.details.status === 500 &&
    error.details.engineType === "NullValueException"
  )
}

/**
 * Per instance of the tree: activity instance tree, incidents and event subscriptions. Instances
 * that ended since the tree was read are `gone` and left out.
 */
async function perInstance(port: EnginePort, ids: readonly string[]) {
  const rows = await mapLimit(ids, PARALLEL, async (pid) => {
    const [activities, incidents, subscriptions] = await Promise.all([
      port.find("getActivityInstanceTree", idInput(pid)),
      port.list("getIncidents", { processInstanceId: pid }),
      port.list("getEventSubscriptions", { processInstanceId: pid }),
    ])
    return { pid, activities, incidents: incidents.items, subscriptions: subscriptions.items }
  })
  const present = rows.filter((row) => row.activities !== undefined)
  return {
    gone: new Set(rows.filter((row) => row.activities === undefined).map((row) => row.pid)),
    activityTrees: records(present.map((row) => row.activities)),
    incidents: present.flatMap((row) => row.incidents),
    subscriptions: present.flatMap((row) => row.subscriptions),
  }
}

/** The variables of the process scope; `gone` when the instance ended meanwhile. */
async function scopeVariables(port: EnginePort, id: string): Promise<Rec | "gone"> {
  try {
    const value = await json(port, "getProcessInstanceVariables", {
      pathArgs: [id],
      query: NO_VALUES,
    })
    return isRecord(value) ? value : {}
  } catch (error) {
    if (endedMeanwhile(error)) return "gone"
    throw error
  }
}

/** Once for the whole tree: tasks, external tasks, jobs, timers, definitions, job definitions. */
async function perTree(port: EnginePort, ids: readonly string[], definitionIds: readonly string[]) {
  const [tasks, externalTasks, jobs, timers, definitions, jobDefinitions] = await Promise.all([
    listByIds(port, { operationId: "getTasks", key: "processInstanceIdIn", ids }),
    listByIds(port, { operationId: "getExternalTasks", key: "processInstanceIdIn", ids }),
    listByIds(port, { operationId: "getJobs", key: "processInstanceIds", ids }),
    listByIds(port, { ...JOBS, ids, query: { timers: "true" } }),
    listByIds(port, {
      operationId: "getProcessDefinitions",
      key: "processDefinitionIdIn",
      ids: definitionIds,
    }),
    mapLimit(definitionIds, PARALLEL, (definitionId) =>
      port.list("getJobDefinitions", { processDefinitionId: definitionId }),
    ),
  ])
  const timerJobIds = new Set(timers.flatMap((timer) => str(timer, "id") ?? []))
  return {
    tasks,
    externalTasks,
    jobs,
    timerJobIds,
    definitions,
    jobDefinitions: jobDefinitions.flatMap((page) => page.items),
  }
}

async function parentOf(port: EnginePort, id: string): Promise<string | undefined> {
  const parents = await port.list("getProcessInstances", { subProcessInstance: id }, 1)
  return str(parents.items[0], "id")
}

/** The data of a running instance; undefined when it ended while the rounds ran. */
async function activeData(
  port: EnginePort,
  ids: { id: string; runtime: Rec; history?: Rec },
  options: InspectOptions,
): Promise<InstanceData | undefined> {
  const { id, runtime, history } = ids
  const [tree, parentId] = await Promise.all([
    activeTree(port, runtime),
    history === undefined ? parentOf(port, id) : undefined,
  ])
  const pids = tree.nodes.map((node) => node.id)
  const definitionIds = [...new Set(tree.nodes.map((node) => node.definitionId))]
  const [{ gone, ...instances }, items, variables, past] = await Promise.all([
    perInstance(port, pids),
    perTree(port, pids, definitionIds),
    options.variables ? scopeVariables(port, id) : undefined,
    options.history ? timeline(port, id) : undefined,
  ])
  if (gone.has(id) || variables === "gone") return undefined
  return {
    ...emptyData(id, options),
    runtime,
    ...compact({ history, parentId, variables }),
    // called instances that ended since the tree was read are left out
    tree: tree.nodes.filter((node) => !gone.has(node.id)),
    truncated: tree.truncated,
    ...instances,
    ...items,
    ...past,
  }
}

/**
 * The root cause of an incident: from the stacktrace of a failed job or the error details of a
 * failed external task, else the incident message; with `stacktrace` also the (first 200) lines.
 */
export async function incidentCause(
  port: EnginePort,
  incident: Rec,
  stacktrace: boolean,
): Promise<IncidentCause> {
  const operation = CAUSE_OPERATIONS.get(field(incident, "incidentType"))
  const configuration = str(incident, "configuration")
  const text =
    operation === undefined || configuration === undefined
      ? undefined
      : await port.text(operation, [configuration])
  const message = str(incident, "incidentMessage")
  const lines = text?.trimEnd().split(/\r?\n/).slice(0, MAX_STACKTRACE_LINES)
  return compact({
    rootCause: (text === undefined ? undefined : rootCause(text)) ?? message,
    stacktrace: stacktrace ? lines : undefined,
  })
}

/** Root causes of the first (at most 10) open root incidents. */
async function causes(port: EnginePort, incidents: readonly Rec[], options: InspectOptions) {
  const first = rootIncidents(incidents).slice(0, MAX_CAUSES)
  const loaded = await mapLimit(first, PARALLEL, (incident) =>
    incidentCause(port, incident, options.stacktrace),
  )
  return new Map(first.map((incident, index) => [field(incident, "id"), loaded[index] ?? {}]))
}

/**
 * The instance view of `id`; NOT_FOUND when neither runtime nor history know it. An instance that
 * ends while the rounds run (a job executor finished it) is loaded once more, then as ended.
 */
export async function loadInstance(
  port: EnginePort,
  id: string,
  options: InspectOptions,
  attempts = 2,
): Promise<InstanceView> {
  const [runtime, history] = await Promise.all(
    instanceRequests(id).map(
      async (request) => records([await port.find(request.operationId, request.input)])[0],
    ),
  )
  if (runtime === undefined && history === undefined) throw instanceMissing(id)
  if (runtime === undefined) return instanceView(await endedData(port, id, history ?? {}, options))
  const data = await activeData(port, { id, runtime, ...compact({ history }) }, options)
  if (data === undefined) {
    if (attempts > 1) return loadInstance(port, id, options, attempts - 1)
    throw instanceMissing(id)
  }
  return instanceView({ ...data, causes: await causes(port, data.incidents, options) })
}

/**
 * The view after a write: an instance that ended without a history record (history level none)
 * is `{id, state: "ENDED"}` instead of NOT_FOUND.
 */
export async function loadView(
  port: EnginePort,
  id: string,
  options: InspectOptions,
): Promise<InstanceView | EndedInstance> {
  try {
    return await loadInstance(port, id, options)
  } catch (error) {
    if (
      error instanceof PulseCliError &&
      error.code === "NOT_FOUND" &&
      error.details.status === undefined
    ) {
      return { id, state: "ENDED" }
    }
    throw error
  }
}

/** `pulse-cli inspect`: the first round only with `--dry-run`, else the view. */
export async function inspect(
  port: EnginePort,
  selection: Selection,
  options: InspectOptions & { readonly dryRun: boolean },
): Promise<WorkflowResult<InstanceView>> {
  checkSelection(selection)
  if (options.dryRun) {
    const requests = selectionRequests(selection)
    return {
      kind: "dry-run",
      requests: requests.length > 0 ? requests : instanceRequests(selection.id ?? ""),
    }
  }
  const id = await selectInstance(port, selection, "inspect")
  return { kind: "view", view: await loadInstance(port, id, options) }
}
