/**
 * A root incident of an instance's detail as the engine contract's `Incident`: raised in the
 * inspected instance or one it called, with the version that instance runs, the retries left of
 * the wait it blocks, the job or external task it names (an external task with its topic) and its
 * stack trace with the root cause, as far as the inspection read it. Pure.
 */

import {
  type DefinitionRef,
  ElementId,
  type Incident,
  type IncidentDetails,
  IncidentId,
  type IncidentJob,
  InstanceId,
  type WaitState,
} from "@miragon/pulse-engine-core"
import { MAX_STACKTRACE_LINES } from "../inspect.js"
import type { IncidentView, WaitState as InspectedWait } from "../types.js"
import { compact } from "../util.js"
import { incidentDetailsOf } from "./incident-texts.js"
import type { InspectView } from "./instance-inspection.js"
import { timestampOf } from "./timestamps.js"

/** The version each instance of the inspected tree runs, by instance id. */
export type DefinitionsByInstance = ReadonlyMap<string, DefinitionRef>

/** What an incident of the detail is read with: the view, the versions, the wait states. */
export interface IncidentFacts {
  readonly view: InspectView
  readonly definitions: DefinitionsByInstance
  readonly waitStates: readonly WaitState[]
}

/** The job of `incident`, or its external task with the topic of the wait it blocks. */
function jobOf(incident: IncidentView, waits: readonly InspectedWait[]): IncidentJob | undefined {
  if (incident.jobId !== undefined) {
    return { id: incident.jobId }
  }
  if (incident.externalTaskId === undefined) {
    return undefined
  }
  const waiting = waits.find(
    (wait) => wait.incidentId === incident.id && wait.kind === "externalTask",
  )
  const topic = waiting?.kind === "externalTask" ? waiting.topic : undefined
  return { id: incident.externalTaskId, ...compact({ type: topic }) }
}

/** The stack trace the inspection read, cut when it holds as many lines as it reads. */
function detailsOf(stacktrace: readonly string[] | undefined): IncidentDetails | undefined {
  return stacktrace === undefined
    ? undefined
    : incidentDetailsOf(
        "stacktrace",
        stacktrace.join("\n"),
        stacktrace.length >= MAX_STACKTRACE_LINES,
      )
}

/** The retries left of the wait `incident` blocks, when its kind counts them. */
function retriesLeftOf(
  incident: IncidentView,
  waitStates: readonly WaitState[],
): number | undefined {
  const waiting = waitStates.find((wait) => wait.incidentId === IncidentId(incident.id))
  return waiting !== undefined && "retriesLeft" in waiting ? waiting.retriesLeft : undefined
}

/**
 * `incident` as the contract's, raised in the instance it names or else the inspected one;
 * undefined when the version that instance runs is unknown.
 */
export function incidentOf(incident: IncidentView, facts: IncidentFacts): Incident | undefined {
  const instanceId = incident.processInstanceId ?? facts.view.id
  const definition = facts.definitions.get(instanceId)
  if (definition === undefined) {
    return undefined
  }
  return {
    id: IncidentId(incident.id),
    instanceId: InstanceId(instanceId),
    definition,
    elementId: ElementId(incident.activityId),
    type: incident.type,
    message: incident.message ?? "",
    createdAt: timestampOf(incident.since),
    ...compact({
      retriesLeft: retriesLeftOf(incident, facts.waitStates),
      job: jobOf(incident, facts.view.waitingAt),
      details: detailsOf(incident.stacktrace),
    }),
  }
}
