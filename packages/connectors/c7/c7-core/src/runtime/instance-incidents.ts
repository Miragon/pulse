/**
 * A root incident of an instance's detail as the engine contract's `Incident`: raised in the
 * inspected instance or one it called, with the version that instance runs, the retries left of
 * the wait it blocks, the job or external task it names (an external task with its topic) and its
 * stack trace with the root cause, as far as the inspection read it; and the cause of each as the
 * cockpit's cause view takes it. Pure.
 */

import {
  ElementId,
  type Incident,
  type IncidentDetails,
  IncidentId,
  type IncidentJob,
  InstanceId,
  type WaitState,
} from "@miragon/pulse-engine-core"
import { MAX_STACKTRACE_LINES } from "../inspect.js"
import { elementOfActivity } from "../multi-instance-body.js"
import type { IncidentView, WaitState as InspectedWait } from "../types.js"
import { compact } from "../util.js"
import { causeKeyOf, type IncidentCauseKey } from "../verdict.js"
import { incidentDetailsOf } from "./incident-texts.js"
import type { InspectView } from "./instance-inspection.js"
import { timestampOf } from "./timestamps.js"
import type { DefinitionsByInstance } from "./tree-versions.js"

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
 * `incident` as the contract's, raised in the instance it names or else the inspected one, at the
 * element of the diagram (a multi-instance body's, at the activity it repeats); undefined when the
 * version that instance runs is unknown.
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
    elementId: ElementId(elementOfActivity(incident.activityId)),
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

/**
 * The cause of each root incident of `view` as the cockpit's cause view takes it (`causeKeyOf`),
 * by incident id: the activity as the engine names it (a multi-instance body's by its own id), the
 * incident type and its message's signature.
 */
export function incidentCausesOf(view: InspectView): ReadonlyMap<IncidentId, IncidentCauseKey> {
  return new Map(
    view.incidents.map((incident) => [
      IncidentId(incident.id),
      causeKeyOf({
        activityId: incident.activityId,
        incidentType: incident.type,
        incidentMessage: incident.message,
      }),
    ]),
  )
}
