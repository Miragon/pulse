/** The fake engine and read options of the inspect tests (src/workflow/inspect*.test.ts). */

import { fakeServer, json, text } from "./fake-fetch.js"
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
} from "./workflow-fixture.js"

const STACKTRACE =
  "org.x.ProcessEngineException: outer\nCaused by: org.x.PropertyNotFoundException: missingBean\n"

/** Parent waiting at its call activity, the child at `approve` with a failed job incident. */
export function approveEngine() {
  const child = {
    id: C,
    definitionId: CHILD_DEF,
    definitionKey: "workflow-child",
    suspended: false,
  }
  return fakeServer()
    .on("GET", `/process-instance/${P}`, json(runtimeDto))
    .on("GET", `/history/process-instance/${P}`, json(historyDto))
    .on("GET", "/process-instance", (request) =>
      json(request.query.get("superProcessInstance") === P ? [child] : []),
    )
    .on(
      "GET",
      `/process-instance/${P}/activity-instances`,
      json(
        activityTree(P, PARENT_DEF, [
          activity("call:ai", "call-approval", "callActivity", ["ex-call"]),
        ]),
      ),
    )
    .on(
      "GET",
      `/process-instance/${C}/activity-instances`,
      json(
        activityTree(C, CHILD_DEF, [
          activity("approve:ai", "approve", "userTask", [C, "name=Approve"]),
        ]),
      ),
    )
    .on("GET", "/incident", (request) =>
      json(
        request.query.get("processInstanceId") === C
          ? [
              {
                id: "i1",
                rootCauseIncidentId: "i1",
                incidentType: "failedJob",
                configuration: "j1",
                activityId: "approve",
                processInstanceId: C,
                incidentMessage: "outer",
                incidentTimestamp: "2026-01-01T00:00:00.000+0000",
              },
            ]
          : [],
      ),
    )
    .on("GET", "/event-subscription", json([]))
    .on(
      "GET",
      "/task",
      json([{ id: "t1", taskDefinitionKey: "approve", executionId: C, processInstanceId: C }]),
    )
    .on("GET", "/external-task", json([]))
    .on("GET", "/job", json([]))
    .on("GET", "/process-definition", json(DEFINITIONS))
    .on("GET", "/job-definition", (request) =>
      json(
        JOB_DEFINITIONS.filter(
          (definition) =>
            definition.processDefinitionId === request.query.get("processDefinitionId"),
        ),
      ),
    )
    .on(
      "GET",
      `/process-instance/${P}/variables`,
      json({ amount: { type: "Integer", value: 250 } }),
    )
    .on("GET", "/job/j1/stacktrace", text(STACKTRACE, "text/plain"))
    .on(
      "GET",
      "/history/activity-instance",
      json([
        {
          activityId: "start",
          activityType: "startEvent",
          startTime: "2026-01-01T00:00:00.000+0000",
        },
      ]),
    )
    .on("GET", "/history/incident", json([]))
}

export const ALL = { variables: true, history: false, stacktrace: false }
