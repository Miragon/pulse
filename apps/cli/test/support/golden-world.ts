/**
 * The engine the output goldens read: one order instance `pi-1` (definition `order`, version 2)
 * that waits at the user task `approve` while its asynchronous `charge` failed for good (job
 * `job-1`, incident `inc-1`), plus one external task of another instance whose topic no worker
 * fetches. Shaped like a CIB seven 2.x answer. The MCP server's goldens read the same world
 * (apps/mcp-server/test/engine-goldens/world.ts): apps share no code, so each keeps its copy,
 * and a change to one changes the other in the same commit.
 */

import type { EngineAnswer, EngineReply, SentRequest } from "./loopback-engine.js"

const DEFINITION_ID = "order:2:6f1e8a"
const STARTED = "2026-10-09T13:38:15.430+0000"
const FAILED = "2026-10-09T13:40:02.112+0000"

const definition = {
  id: DEFINITION_ID,
  key: "order",
  name: "Order",
  version: 2,
  deploymentId: "dep-2",
  suspended: false,
}

const runtime = {
  id: "pi-1",
  definitionId: DEFINITION_ID,
  definitionKey: "order",
  businessKey: "B-7",
  ended: false,
  suspended: false,
}

const history = {
  id: "pi-1",
  businessKey: "B-7",
  processDefinitionId: DEFINITION_ID,
  processDefinitionKey: "order",
  processDefinitionName: "Order",
  processDefinitionVersion: 2,
  startTime: STARTED,
  endTime: null,
  durationInMillis: null,
  rootProcessInstanceId: "pi-1",
  superProcessInstanceId: null,
  state: "ACTIVE",
}

const CHARGE_ERROR = "Card declined: insufficient funds (order B-7)"

const incident = {
  id: "inc-1",
  rootCauseIncidentId: "inc-1",
  causeIncidentId: "inc-1",
  incidentType: "failedJob",
  activityId: "charge",
  failedActivityId: "charge",
  processInstanceId: "pi-1",
  processDefinitionId: DEFINITION_ID,
  executionId: "pi-1",
  configuration: "job-1",
  incidentMessage: CHARGE_ERROR,
  incidentTimestamp: FAILED,
  annotation: null,
}

const job = {
  id: "job-1",
  jobDefinitionId: "jd-charge",
  processInstanceId: "pi-1",
  processDefinitionId: DEFINITION_ID,
  processDefinitionKey: "order",
  executionId: "pi-1",
  failedActivityId: "charge",
  retries: 0,
  dueDate: null,
  createTime: "2026-10-09T13:38:15.512+0000",
  exceptionMessage: CHARGE_ERROR,
  suspended: false,
  priority: 0,
}

const STACKTRACE = [
  "org.cibseven.bpm.engine.ProcessEngineException: Card declined: insufficient funds (order B-7)",
  "\tat com.example.order.ChargeDelegate.execute(ChargeDelegate.java:42)",
  "Caused by: com.example.payment.PaymentRefusedException: insufficient funds",
  "\tat com.example.payment.Gateway.charge(Gateway.java:17)",
  "",
].join("\n")

const tree = {
  id: "pi-1",
  parentActivityInstanceId: null,
  activityId: DEFINITION_ID,
  activityType: "processDefinition",
  processInstanceId: "pi-1",
  processDefinitionId: DEFINITION_ID,
  executionIds: ["pi-1"],
  childActivityInstances: [
    {
      id: "approve:ai-1",
      activityId: "approve",
      activityType: "userTask",
      activityName: "Approve order",
      executionIds: ["ex-approve"],
      childActivityInstances: [],
      childTransitionInstances: [],
    },
  ],
  childTransitionInstances: [
    {
      id: "charge:ti-1",
      activityId: "charge",
      activityType: "serviceTask",
      activityName: "Charge card",
      executionId: "pi-1",
    },
  ],
}

const task = {
  id: "task-1",
  name: "Approve order",
  taskDefinitionKey: "approve",
  executionId: "ex-approve",
  processInstanceId: "pi-1",
  processDefinitionId: DEFINITION_ID,
  created: "2026-10-09T13:38:15.498+0000",
  assignee: "demo",
  due: null,
}

const externalTask = {
  id: "et-1",
  activityId: "send-invoice",
  activityInstanceId: "send-invoice:ai-9",
  executionId: "pi-2",
  processInstanceId: "pi-2",
  processDefinitionId: DEFINITION_ID,
  processDefinitionKey: "order",
  topicName: "invoice-mail",
  workerId: null,
  lockExpirationTime: null,
  retries: null,
  errorMessage: null,
  suspended: false,
  priority: 0,
  createTime: "2026-10-09T13:39:00.000+0000",
}

const statistics = [
  {
    id: DEFINITION_ID,
    instances: 2,
    failedJobs: 1,
    incidents: [{ incidentType: "failedJob", incidentCount: 1 }],
    definition,
  },
]

const VARIABLES = {
  amount: { type: "Integer", value: 250, valueInfo: {} },
  customer: { type: "String", value: "ACME Corp", valueInfo: {} },
  express: { type: "Boolean", value: true, valueInfo: {} },
}

/** The query of a recorded target. */
const queryOf = (request: SentRequest) => new URL(request.target, "http://engine").searchParams

/** Reads that depend on their filter: one instance's own rows, or the whole engine's. */
function filtered(path: string, request: SentRequest): EngineReply | undefined {
  const query = queryOf(request)
  const ofInstance = (query.get("processInstanceIdIn") ?? query.get("processInstanceId")) !== null
  const executableOrTimer = query.has("executable") || query.has("timers")
  switch (path) {
    case "/external-task":
      return { body: ofInstance ? [] : [externalTask] }
    case "/job":
      // job-1 is no timer, and not executable (no retries left): the status's overdue scan and
      // the timer read find nothing, and the count of executable jobs is 0
      return { body: executableOrTimer ? [] : [job] }
    case "/job/count":
      return { body: { count: executableOrTimer ? 0 : 1 } }
    case "/process-instance":
      // the instances `pi-1` called: none
      return { body: [] }
    default:
      return undefined
  }
}

const ROUTES: Readonly<Record<string, EngineReply>> = {
  "/version": { body: { version: "2.1.0" } },
  "/process-definition/statistics": { body: statistics },
  "/process-definition": { body: [definition] },
  "/job-definition": {
    body: [
      {
        id: "jd-charge",
        processDefinitionId: DEFINITION_ID,
        processDefinitionKey: "order",
        activityId: "charge",
        jobType: "async-continuation",
        jobConfiguration: "async-before",
        suspended: false,
      },
    ],
  },
  "/incident": { body: [incident] },
  "/incident/count": { body: { count: 1 } },
  "/batch/statistics": { body: [] },
  "/external-task/count": { body: { count: 1 } },
  "/task": { body: [task] },
  "/task/count": { body: { count: 1 } },
  "/event-subscription": { body: [] },
  "/process-instance/pi-1": { body: runtime },
  "/history/process-instance/pi-1": { body: history },
  "/process-instance/pi-1/activity-instances": { body: tree },
  "/process-instance/pi-1/variables": { body: VARIABLES },
  "/job/job-1/stacktrace": { raw: STACKTRACE, contentType: "text/plain" },
}

/** The world's answer to a read below `/engine-rest`; anything else is a 404 NotFoundException. */
export const worldAnswer: EngineAnswer = (request) => {
  const path = new URL(request.target, "http://engine").pathname.replace(/^\/engine-rest/, "")
  return filtered(path, request) ?? ROUTES[path]
}
