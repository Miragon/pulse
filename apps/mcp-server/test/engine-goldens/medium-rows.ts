import {
  COPY_SLOT,
  ELEMENT_OF,
  endedIdOf,
  engineDate,
  instanceIdOf,
  type MediumWorld,
  PERIOD,
  type State,
  stateOf,
  TIMES,
  type Version,
} from "./medium-world.js"

/**
 * The rows of the medium engine (medium-world.ts), shaped like Operaton's and CIB seven's answers:
 * each made from its version and number alone, so a row reads the same in every answer that
 * holds it.
 */

/** A running instance of the world: its version and number. */
export interface Instance {
  readonly version: Version
  readonly n: number
}

/** The state of a running instance; billing's follows the slot of the instance that called it. */
export function stateOfInstance(world: MediumWorld, { version, n }: Instance): State {
  if (version.key !== "billing") return stateOf(n % PERIOD, version.caller)
  return world.callerOf(n).n % PERIOD === COPY_SLOT ? "chargeFailed" : "review"
}

/** Whether a calling instance holds a copy of its called instance's incident. */
export const holdsCopy = ({ version, n }: Instance) => version.caller && n % PERIOD === COPY_SLOT

/** The slot of a running instance; a billing instance's is its caller's. */
export function slotOf(world: MediumWorld, { version, n }: Instance): number {
  return (version.key === "billing" ? world.callerOf(n).n : n) % PERIOD
}

/** A deployed version as `/process-definition` lists it. */
export function definitionRow(version: Version) {
  const name = version.key === "billing" ? "Billing" : `Process ${version.key.slice(-2)}`
  return {
    id: version.id,
    key: version.key,
    category: "http://bpmn.io/schema/bpmn",
    description: null,
    name,
    version: version.version,
    resource: `${version.key}.bpmn`,
    deploymentId: version.deploymentId,
    diagram: null,
    suspended: false,
    tenantId: null,
    versionTag: null,
    historyTimeToLive: 30,
    startableInTasklist: true,
  }
}

const businessKeyOf = (instance: Instance) => `bk-${instanceIdOf(instance.version, instance.n)}`

/** A running instance as `/process-instance` lists it. */
export function instanceRow(instance: Instance) {
  return {
    links: [],
    id: instanceIdOf(instance.version, instance.n),
    definitionId: instance.version.id,
    definitionKey: instance.version.key,
    businessKey: businessKeyOf(instance),
    caseInstanceId: null,
    ended: false,
    suspended: false,
    tenantId: null,
  }
}

/** The calling instance's id of a billing instance; null for any other. */
function superOf(world: MediumWorld, { version, n }: Instance): string | null {
  if (version.key !== "billing") return null
  const caller = world.callerOf(n)
  return instanceIdOf(caller.version, caller.n)
}

function historicRow(world: MediumWorld, version: Version, times: { start: number; end?: number }) {
  return {
    processDefinitionId: version.id,
    processDefinitionKey: version.key,
    processDefinitionName: definitionRow(version).name,
    processDefinitionVersion: version.version,
    startTime: engineDate(times.start),
    endTime: times.end === undefined ? null : engineDate(times.end),
    removalTime: null,
    durationInMillis: times.end === undefined ? null : times.end - times.start,
    startUserId: null,
    startActivityId: "start",
    deleteReason: null,
    superCaseInstanceId: null,
    caseInstanceId: null,
    tenantId: null,
    state: times.end === undefined ? "ACTIVE" : "COMPLETED",
    restartedProcessInstanceId: null,
  }
}

/** A running instance as the history holds it. */
export function historicRunningRow(world: MediumWorld, instance: Instance) {
  const id = instanceIdOf(instance.version, instance.n)
  const superId = superOf(world, instance)
  return {
    id,
    businessKey: businessKeyOf(instance),
    ...historicRow(world, instance.version, { start: TIMES.started(instance.version, instance.n) }),
    rootProcessInstanceId: superId ?? id,
    superProcessInstanceId: superId,
  }
}

/** An ended instance as the history holds it. */
export function historicEndedRow(world: MediumWorld, version: Version, m: number) {
  const end = TIMES.ended(version, m)
  const id = endedIdOf(version, m)
  return {
    id,
    businessKey: `bk-${id}`,
    ...historicRow(world, version, { start: end - TIMES.duration, end }),
    rootProcessInstanceId: id,
    superProcessInstanceId: null,
  }
}

const CHARGE_ERROR = "Card declined: insufficient funds"
const NOTIFY_ERROR = "Mail gateway refused the message"

/**
 * The incident an instance holds, a root or a copy at callBilling; undefined for none. An instance
 * holds one at most, so its id is the instance's behind `inc-`, a copy's as a root's, and the ids'
 * text order is their instances'.
 */
export function incidentRow(world: MediumWorld, instance: Instance) {
  const id = instanceIdOf(instance.version, instance.n)
  const state = stateOfInstance(world, instance)
  const copy = holdsCopy(instance)
  if (!copy && state !== "chargeFailed" && state !== "notifyFailed") return undefined
  const called = copy
    ? instanceIdOf(world.billing, world.calledBy(instance.version, instance.n))
    : id
  const rootId = `inc-${called}`
  const external = state === "notifyFailed"
  return {
    id: `inc-${id}`,
    processDefinitionId: instance.version.id,
    processInstanceId: id,
    executionId: id,
    incidentTimestamp: engineDate(
      TIMES.started(instance.version, instance.n) + TIMES.incidentAfter,
    ),
    incidentType: external ? "failedExternalTask" : "failedJob",
    activityId: copy ? "callBilling" : ELEMENT_OF[state],
    failedActivityId: copy ? "charge" : ELEMENT_OF[state],
    causeIncidentId: rootId,
    rootCauseIncidentId: rootId,
    configuration: copy ? null : `${external ? "et" : "job"}-${id}`,
    incidentMessage: external ? NOTIFY_ERROR : CHARGE_ERROR,
    tenantId: null,
    jobDefinitionId: external || copy ? null : `jd-${instance.version.id}`,
    annotation: null,
  }
}

/** The retries a job has left by its instance's state: none where its charge failed for good. */
export const JOB_RETRIES = { chargeFailed: 0, charge: 3 } as const

/** The job of an instance at charge: failed for good, or due now. */
export function jobRow(world: MediumWorld, instance: Instance) {
  const id = instanceIdOf(instance.version, instance.n)
  const failed = stateOfInstance(world, instance) === "chargeFailed"
  return {
    id: `job-${id}`,
    jobDefinitionId: `jd-${instance.version.id}`,
    processInstanceId: id,
    processDefinitionId: instance.version.id,
    processDefinitionKey: instance.version.key,
    executionId: id,
    exceptionMessage: failed ? CHARGE_ERROR : null,
    failedActivityId: failed ? "charge" : null,
    retries: failed ? JOB_RETRIES.chargeFailed : JOB_RETRIES.charge,
    dueDate: null,
    suspended: false,
    priority: 0,
    tenantId: null,
    createTime: engineDate(TIMES.started(instance.version, instance.n) + TIMES.jobAfter),
    batchId: null,
  }
}

/** The job definition of a version's asynchronous charge. */
export function jobDefinitionRow(version: Version) {
  return {
    id: `jd-${version.id}`,
    processDefinitionId: version.id,
    processDefinitionKey: version.key,
    jobType: "async-continuation",
    jobConfiguration: "async-before",
    activityId: "charge",
    suspended: false,
    overridingJobPriority: null,
    tenantId: null,
    deploymentId: null,
  }
}

/** Whether the user task of an instance at review is assigned, to `demo`: by its slot. */
export const assignedAt = (slot: number) => slot % 3 === 0

/** The user task of an instance at review. */
export function taskRow(world: MediumWorld, instance: Instance) {
  const id = instanceIdOf(instance.version, instance.n)
  return {
    id: `task-${id}`,
    name: "Review",
    assignee: assignedAt(slotOf(world, instance)) ? "demo" : null,
    created: engineDate(TIMES.started(instance.version, instance.n) + TIMES.taskAfter),
    due: null,
    followUp: null,
    lastUpdated: null,
    delegationState: null,
    description: null,
    executionId: id,
    owner: null,
    parentTaskId: null,
    priority: 50,
    processDefinitionId: instance.version.id,
    processInstanceId: id,
    taskDefinitionKey: "review",
    caseExecutionId: null,
    caseInstanceId: null,
    caseDefinitionId: null,
    suspended: false,
    formKey: null,
    camundaFormRef: null,
    tenantId: null,
  }
}

/** The external task of an instance at notify. */
export function externalTaskRow(world: MediumWorld, instance: Instance) {
  const id = instanceIdOf(instance.version, instance.n)
  const failed = stateOfInstance(world, instance) === "notifyFailed"
  return {
    id: `et-${id}`,
    activityId: "notify",
    activityInstanceId: `notify:${id}`,
    errorMessage: failed ? NOTIFY_ERROR : null,
    executionId: id,
    lockExpirationTime: null,
    processDefinitionId: instance.version.id,
    processDefinitionKey: instance.version.key,
    processDefinitionVersionTag: null,
    processInstanceId: id,
    retries: failed ? 0 : null,
    suspended: false,
    workerId: null,
    topicName: "notify-customer",
    tenantId: null,
    priority: 0,
    businessKey: businessKeyOf(instance),
    createTime: engineDate(TIMES.started(instance.version, instance.n) + 90_000),
  }
}

/** The variables every instance holds, by name. */
export function variablesOf(instance: Instance) {
  return {
    amount: { type: "Integer", value: 100 + (instance.n % 900), valueInfo: {} },
    customer: { type: "String", value: `Customer ${instance.n % 97}`, valueInfo: {} },
    express: { type: "Boolean", value: instance.n % 2 === 0, valueInfo: {} },
    orderId: { type: "String", value: businessKeyOf(instance), valueInfo: {} },
  }
}

/** The variables of an instance as rows of `/variable-instance` and its history. */
export function variableRows(instance: Instance) {
  const id = instanceIdOf(instance.version, instance.n)
  return Object.entries(variablesOf(instance)).map(([name, value]) => ({
    ...value,
    id: `var-${name}-${id}`,
    name,
    processDefinitionId: instance.version.id,
    processDefinitionKey: instance.version.key,
    processInstanceId: id,
    executionId: id,
    activityInstanceId: id,
    caseInstanceId: null,
    caseExecutionId: null,
    taskId: null,
    batchId: null,
    errorMessage: null,
    tenantId: null,
    state: "CREATED",
  }))
}

/** The elements an instance in `state` passed before the one it waits at, in order. */
const PATH: Readonly<Record<State, readonly string[]>> = {
  review: ["start"],
  called: ["start", "review"],
  chargeFailed: ["start", "review"],
  charge: ["start", "review"],
  notify: ["start", "review", "charge"],
  notifyFailed: ["start", "review", "charge"],
}

/** The elements an instance in `state` passed before the one it waits at. */
export const pathOf = (state: State) => PATH[state]

/** The steps of an instance in `state`, in order: what it passed, and where it waits. */
export const stepsOf = (state: State) => [...PATH[state], ELEMENT_OF[state]]

const TYPES: Readonly<Record<string, string>> = {
  start: "startEvent",
  review: "userTask",
  charge: "serviceTask",
  notify: "serviceTask",
  callBilling: "callActivity",
}

/** The activity history of a running instance: what it passed, and where it waits. */
export function activityRows(world: MediumWorld, instance: Instance) {
  const id = instanceIdOf(instance.version, instance.n)
  const state = stateOfInstance(world, instance)
  const started = TIMES.started(instance.version, instance.n)
  const steps = stepsOf(state)
  return steps.map((activityId, at) => {
    const open = at === steps.length - 1
    const called =
      activityId === "callBilling"
        ? instanceIdOf(world.billing, world.calledBy(instance.version, instance.n))
        : null
    return {
      id: `${activityId}:${id}`,
      parentActivityInstanceId: id,
      activityId,
      activityName: activityId,
      activityType: TYPES[activityId],
      processDefinitionKey: instance.version.key,
      processDefinitionId: instance.version.id,
      processInstanceId: id,
      executionId: id,
      taskId: activityId === "review" ? `task-${id}` : null,
      calledProcessInstanceId: called,
      calledCaseInstanceId: null,
      assignee: null,
      startTime: engineDate(started + at * TIMES.step),
      endTime: open ? null : engineDate(started + at * TIMES.step + 500),
      durationInMillis: open ? null : 500,
      canceled: false,
      completeScope: false,
      tenantId: null,
      removalTime: null,
      rootProcessInstanceId: superOf(world, instance) ?? id,
    }
  })
}

/** The activity tree of a running instance: one activity instance where it waits. */
export function activityTree(world: MediumWorld, instance: Instance) {
  const id = instanceIdOf(instance.version, instance.n)
  const element = ELEMENT_OF[stateOfInstance(world, instance)]
  const waiting = element !== "charge"
  const child = {
    id: `${element}:${id}`,
    parentActivityInstanceId: id,
    activityId: element,
    activityType: TYPES[element],
    processInstanceId: id,
    processDefinitionId: instance.version.id,
    activityName: element,
    name: element,
    executionIds: [id],
    childActivityInstances: [],
    childTransitionInstances: [],
    incidentIds: [],
    incidents: [],
  }
  const transition = {
    id: `${element}:t-${id}`,
    parentActivityInstanceId: id,
    activityId: element,
    activityType: TYPES[element],
    processInstanceId: id,
    processDefinitionId: instance.version.id,
    activityName: element,
    targetActivityId: element,
    executionId: id,
    incidentIds: [],
    incidents: [],
  }
  return {
    id,
    parentActivityInstanceId: null,
    activityId: instance.version.id,
    activityType: "processDefinition",
    processInstanceId: id,
    processDefinitionId: instance.version.id,
    activityName: definitionRow(instance.version).name,
    name: definitionRow(instance.version).name,
    executionIds: [id],
    childActivityInstances: waiting ? [child] : [],
    childTransitionInstances: waiting ? [] : [transition],
    incidentIds: [],
    incidents: [],
  }
}

/** The diagram of a version: billing's has no call activity, a calling process's has one. */
export function diagramOf(version: Version): string {
  const call = version.caller
    ? '<bpmn:callActivity id="callBilling" name="Bill" calledElement="billing"/>'
    : ""
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ' +
    'xmlns:camunda="http://camunda.org/schema/1.0/bpmn" id="d" targetNamespace="t">' +
    `<bpmn:process id="${version.key}" name="${definitionRow(version).name}" isExecutable="true">` +
    '<bpmn:startEvent id="start" name="Received"/>' +
    '<bpmn:userTask id="review" name="Review"/>' +
    call +
    '<bpmn:serviceTask id="charge" name="Charge" camunda:asyncBefore="true" camunda:expression="${true}"/>' +
    '<bpmn:serviceTask id="notify" name="Notify" camunda:type="external" camunda:topic="notify-customer"/>' +
    '<bpmn:endEvent id="end" name="Done"/>' +
    "</bpmn:process></bpmn:definitions>"
  )
}
