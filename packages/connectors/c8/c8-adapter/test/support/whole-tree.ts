import { page, problem, type RestRoute } from "./fake-camunda-rest.js"
import { ACTIVE_ONLY, about } from "./instance-tree.js"
import { element, ENDED_AT, instance } from "./rows.js"

export const RUNS_OF_THE_ROOT = [
  element("10", "Start", "START_EVENT", { state: "COMPLETED", endDate: ENDED_AT }),
  element("11", "Skipped", "SERVICE_TASK", { state: "TERMINATED", endDate: ENDED_AT }),
  element("12", "Review", "USER_TASK"),
  element("13", "Call", "CALL_ACTIVITY"),
  element("14", "Wait", "INTERMEDIATE_CATCH_EVENT"),
  element("15", "Pay", "RECEIVE_TASK"),
  element("16", "Script", "SCRIPT_TASK"),
  element("17", "Odd", "MANUAL_TASK"),
  element("18", "Bpmn", "PROCESS"),
]
export const DETAIL_ROUTES: readonly RestRoute[] = [
  { route: "GET /process-instances/1", answer: instance("1", { hasIncident: true }) },
  {
    route: "POST /process-instances/search",
    when: (body) => body.includes('"$in":["1"]'),
    answer: page([
      instance("2", {
        processDefinitionKey: "300",
        processDefinitionId: "label",
        processDefinitionVersion: 3,
        processDefinitionName: "Label",
        parentProcessInstanceKey: "1",
        parentElementInstanceKey: "13",
        hasIncident: true,
      }),
    ]),
  },
  {
    route: "POST /process-instances/search",
    when: (body) => body.includes('"$in":["2"]'),
    answer: page([]),
  },
  {
    route: "POST /element-instances/search",
    when: about("1", ACTIVE_ONLY),
    answer: page(RUNS_OF_THE_ROOT.filter((run) => run.state === "ACTIVE")),
  },
  {
    route: "POST /element-instances/search",
    when: about("1"),
    answer: page(RUNS_OF_THE_ROOT.toReversed()),
  },
  {
    route: "POST /element-instances/search",
    when: about("2", ACTIVE_ONLY),
    answer: page([element("20", "Render", "SERVICE_TASK", { incidentKey: "7" })]),
  },
  {
    route: "POST /jobs/search",
    when: (body) => body.includes('"processInstanceKey":"1"'),
    answer: page([
      { jobKey: "51", type: "done", state: "COMPLETED", elementInstanceKey: "16", retries: 0 },
      {
        jobKey: "52",
        type: "listener",
        state: "CREATED",
        kind: "EXECUTION_LISTENER",
        elementInstanceKey: "16",
      },
      {
        jobKey: "53",
        type: "script",
        state: "CREATED",
        kind: "BPMN_ELEMENT",
        elementInstanceKey: "16",
        retries: 2,
      },
    ]),
  },
  {
    route: "POST /jobs/search",
    when: (body) => body.includes('"processInstanceKey":"2"'),
    answer: page([
      {
        jobKey: "70",
        type: "render-label",
        state: "FAILED",
        kind: "BPMN_ELEMENT",
        elementInstanceKey: "20",
        retries: 0,
      },
    ]),
  },
  {
    route: "POST /user-tasks/search",
    when: (body) => body.includes('"processInstanceKey":"1"'),
    answer: page([
      { elementInstanceKey: "12", assignee: "demo", dueDate: "2026-12-01T00:00:00.000Z" },
    ]),
  },
  { route: "POST /user-tasks/search", answer: page([]) },
  {
    route: "POST /message-subscriptions/search",
    when: (body) => body.includes('"processInstanceKey":"1"'),
    answer: page([
      {
        elementInstanceKey: "15",
        elementId: "Pay",
        messageName: "Paid",
        correlationKey: "ORD-1",
      },
    ]),
  },
  { route: "POST /message-subscriptions/search", answer: page([]) },
  {
    route: "POST /incidents/search",
    answer: page([
      {
        incidentKey: "7",
        processInstanceKey: "2",
        processDefinitionKey: "300",
        elementId: "Render",
        errorType: "JOB_NO_RETRIES",
        errorMessage: "no paper",
        creationTime: "2026-11-05T10:00:00.000Z",
        jobKey: "70",
      },
      {
        incidentKey: "9",
        processInstanceKey: "elsewhere",
        processDefinitionKey: "300",
        elementId: "Render",
        errorType: "JOB_NO_RETRIES",
        errorMessage: "not in this tree",
        creationTime: "2026-11-05T10:00:00.000Z",
      },
    ]),
  },
  {
    route: "POST /variables/search",
    answer: page([
      {
        name: "route",
        value: '"review"',
        isTruncated: false,
        scopeKey: "1",
        processInstanceKey: "1",
      },
      {
        name: "note",
        value: '"local"',
        isTruncated: false,
        scopeKey: "12",
        processInstanceKey: "1",
      },
      { name: "big", value: '"cut', isTruncated: true, scopeKey: "404", processInstanceKey: "1" },
    ]),
  },
  { route: "GET /element-instances/404", answer: problem(404, "NOT_FOUND", "missing") },
  {
    route: "GET /process-definitions/100/xml",
    answer: new Response(
      `<bpmn:definitions>
        <bpmn:intermediateCatchEvent id="Wait"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
        <bpmn:intermediateCatchEvent id="Stop"><bpmn:signalEventDefinition /></bpmn:intermediateCatchEvent>
      </bpmn:definitions>`,
    ),
  },
]
