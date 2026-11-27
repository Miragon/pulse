/**
 * The detail of an inspected instance as the engine contract's `InstanceDetail`: its summary, the
 * path the history recorded, where it and its called instances wait, the root incidents of its
 * tree, the instances it called and its variables, cut when the inspection or the variables were.
 * Pure.
 */

import {
  ElementId,
  type ElementRun,
  IncidentId,
  type InstanceDetail,
  InstanceId,
  type InstanceSummary,
  type WaitState,
} from "@miragon/pulse-engine-core"
import { elementOfActivity } from "../multi-instance-body.js"
import type { TimelineEntry, WaitState as InspectedWait } from "../types.js"
import { compact } from "../util.js"
import { calledInstanceOf } from "./called-instances.js"
import { definitionRefOf } from "./definition-refs.js"
import { incidentOf } from "./instance-incidents.js"
import type { InspectView } from "./instance-inspection.js"
import { instanceStateOf } from "./instance-states.js"
import { variablesOf } from "./instance-variables.js"
import { optionalTimestampOf, timestampOf } from "./timestamps.js"
import type { DefinitionsByInstance } from "./tree-versions.js"
import { VARIABLE_PAGE_SIZE, type VariableRow } from "./variable-instances.js"

/** The inspected instance as the contract's summary: with an incident of its own or copied up. */
function summaryOf(view: InspectView): InstanceSummary {
  return {
    id: InstanceId(view.id),
    definition: definitionRefOf(view.definition),
    state: instanceStateOf(view.state),
    hasIncident: view.incidents.length > 0 || (view.propagatedIncidents ?? 0) > 0,
    ...compact({
      businessKey: view.businessKey,
      startedAt: optionalTimestampOf(view.startTime),
      endedAt: optionalTimestampOf(view.endTime),
      parentInstanceId: view.parentId === undefined ? undefined : InstanceId(view.parentId),
    }),
  }
}

/** A step of the history's path as the contract's run of an element. */
function runOf(entry: TimelineEntry): ElementRun {
  return {
    elementId: ElementId(entry.activityId),
    startedAt: timestampOf(entry.startTime),
    canceled: entry.canceled === true,
    ...compact({ elementName: entry.activityName, endedAt: optionalTimestampOf(entry.endTime) }),
  }
}

/**
 * What every wait state says: the instance it is in, its element (a multi-instance body's, the
 * activity it repeats), since when, its incident.
 */
function waitBaseOf(wait: InspectedWait, inspectedInstanceId: string) {
  const { attachedTo } = wait
  return {
    instanceId: InstanceId(wait.processInstanceId ?? inspectedInstanceId),
    elementId: ElementId(elementOfActivity(wait.activityId)),
    ...compact({
      elementName: wait.activityName,
      attachedToElementId:
        attachedTo === undefined ? undefined : ElementId(elementOfActivity(attachedTo)),
      since: optionalTimestampOf(wait.since),
      incidentId: wait.incidentId === undefined ? undefined : IncidentId(wait.incidentId),
    }),
  }
}

/** `wait` of the inspected tree as the contract's wait state; a kind it has no name for is `other`. */
function waitStateOf(wait: InspectedWait, inspectedInstanceId: string): WaitState {
  const base = waitBaseOf(wait, inspectedInstanceId)
  switch (wait.kind) {
    case "userTask":
      return {
        ...base,
        kind: "userTask",
        ...compact({ assignee: wait.assignee, dueAt: optionalTimestampOf(wait.due) }),
      }
    case "externalTask":
      return {
        ...base,
        kind: "workerTask",
        taskType: wait.topic,
        ...compact({ retriesLeft: wait.retries }),
      }
    case "asyncContinuation":
      return { ...base, kind: "asyncContinuation", retriesLeft: wait.retries }
    case "timer":
      return {
        ...base,
        kind: "timer",
        ...compact({ dueAt: optionalTimestampOf(wait.dueDate === "" ? undefined : wait.dueDate) }),
      }
    case "message":
      return { ...base, kind: "message", ...compact({ messageName: wait.eventName }) }
    case "signal":
      return { ...base, kind: "signal", ...compact({ signalName: wait.eventName }) }
    default:
      return { ...base, kind: "other", description: wait.activityType ?? wait.kind }
  }
}

/**
 * The detail of `view`, its incidents with the version of the instance each was raised in
 * (`definitions`), its variables the typed ones of every scope (`typed`) while it runs, else
 * the inspection's.
 */
export function instanceDetailOf(
  view: InspectView,
  definitions: DefinitionsByInstance,
  typed: readonly VariableRow[] | undefined,
): InstanceDetail {
  const waitStates = view.waitingAt.map((wait) => waitStateOf(wait, view.id))
  const instance = summaryOf(view)
  return {
    instance,
    path: view.timeline.map((entry) => runOf(entry)),
    waitStates,
    incidents: view.incidents.flatMap(
      (incident) => incidentOf(incident, { view, definitions, waitStates }) ?? [],
    ),
    calledInstances: view.children.map((child) => calledInstanceOf(child, view.timeline)),
    variables: variablesOf(instance.state, view.variables, typed),
    truncated: view.truncated === true || (typed?.length ?? 0) >= VARIABLE_PAGE_SIZE,
  }
}
