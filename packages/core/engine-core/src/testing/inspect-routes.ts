/**
 * The routes of a fake port at the verified fixture's `approve` stage: the parent waits at its
 * call activity, the child at the user task `approve` with a failed job incident.
 */

import type { Rec } from "../records.js"
import type { Route } from "./fake-port.js"
import {
  activity,
  activityTree,
  C,
  CHILD_DEF,
  DEFINITIONS,
  historyDto,
  JOB_DEFINITIONS,
  P,
  PARENT_DEF,
  runtimeDto,
} from "./fixture.js"

export const STACKTRACE =
  "org.x.ProcessEngineException: outer\nCaused by: org.x.PropertyNotFoundException: missingBean\n"

/** The open root incident of the child, a failed job. */
export const APPROVE_INCIDENT: Rec = {
  id: "i1",
  rootCauseIncidentId: "i1",
  incidentType: "failedJob",
  configuration: "j1",
  activityId: "approve",
  processInstanceId: C,
  incidentMessage: "outer",
  incidentTimestamp: "2026-01-01T00:00:00.000+0000",
}

const CHILD: Rec = {
  id: C,
  definitionId: CHILD_DEF,
  definitionKey: "workflow-child",
  suspended: false,
}

const TREES: Readonly<Record<string, Rec>> = {
  [P]: activityTree(P, PARENT_DEF, [
    activity("call:ai", "call-approval", "callActivity", ["ex-call"]),
  ]),
  [C]: activityTree(C, CHILD_DEF, [
    activity("approve:ai", "approve", "userTask", [C, "name=Approve"]),
  ]),
}

/** Every read inspect sends for the approve stage, by operation id. */
export function approveRoutes(): Record<string, Route> {
  return {
    getProcessInstance: (input) => (input.pathArgs[0] === P ? runtimeDto : undefined),
    getHistoricProcessInstance: (input) => (input.pathArgs[0] === P ? historyDto : undefined),
    getProcessInstances: (input) => (input.query.superProcessInstance === P ? [CHILD] : []),
    getActivityInstanceTree: (input) => TREES[input.pathArgs[0] ?? ""],
    getIncidents: (input) => (input.query.processInstanceId === C ? [APPROVE_INCIDENT] : []),
    getEventSubscriptions: () => [],
    getTasks: () => [
      { id: "t1", taskDefinitionKey: "approve", executionId: C, processInstanceId: C },
    ],
    getExternalTasks: () => [],
    getJobs: () => [],
    getProcessDefinitions: () => DEFINITIONS,
    getJobDefinitions: (input) =>
      JOB_DEFINITIONS.filter(
        (definition) => definition.processDefinitionId === input.query.processDefinitionId,
      ),
    getProcessInstanceVariables: () => ({ amount: { type: "Integer", value: 250 } }),
    getStacktrace: () => STACKTRACE,
    getExternalTaskErrorDetails: () => undefined,
    getHistoricVariableInstances: () => [],
    getHistoricActivityInstances: () => [
      {
        activityId: "start",
        activityType: "startEvent",
        startTime: "2026-01-01T00:00:00.000+0000",
      },
    ],
    getHistoricIncidents: () => [],
    getHistoricProcessInstances: () => [],
  }
}
