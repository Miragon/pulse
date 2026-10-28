/** The endpoint follows from the task (`lib/task-completion.ts`). */
import type { FakeRoutes } from "./fake-engine.js"
import type { WireRequest, WriteCase } from "./write-cases.js"

export const TASK = {
  id: "t-1",
  taskDefinitionKey: "review",
  processDefinitionId: "def-1",
  delegationState: null,
  owner: null,
  assignee: "john",
}
/** Delegated in Tasklist: mary owns it, john works it. */
const DELEGATED = { ...TASK, delegationState: "PENDING", owner: "mary" }

const bpmn = (formData: string) =>
  `<definitions xmlns:camunda="http://camunda.org/schema/1.0/bpmn"><process id="p">` +
  `<userTask id="review"><extensionElements>${formData}</extensionElements></userTask>` +
  `</process></definitions>`

const NO_FORM_BPMN = bpmn("")
export const FORM_BPMN = bpmn(`<camunda:formData>
  <camunda:formField id="amount" type="long">
    <camunda:validation><camunda:constraint name="required" /></camunda:validation>
  </camunda:formField>
  <camunda:formField id="priority" type="long" defaultValue="50" />
  <camunda:formField id="channel" type="string" defaultValue="web" />
  <camunda:formField id="approved" type="boolean" defaultValue="false">
    <camunda:validation><camunda:constraint name="readonly" /></camunda:validation>
  </camunda:formField>
  <camunda:formField id="comment" type="string" />
</camunda:formData>`)

export function taskRoutes(task: object, xml: string, variables?: object): FakeRoutes {
  return {
    "GET /task/t-1": { body: task },
    "GET /process-definition/def-1/xml": { body: { id: "def-1", bpmn20Xml: xml } },
    ...(variables ? { "GET /task/t-1/variables": { body: variables } } : {}),
  }
}

const READ_TASK: WireRequest = { method: "GET", path: "/task/t-1" }
const READ_BPMN: WireRequest = { method: "GET", path: "/process-definition/def-1/xml" }
const READ_VARIABLES: WireRequest = {
  method: "GET",
  path: "/task/t-1/variables",
  query: { deserializeValues: "false" },
}

const AMOUNT = { amount: { value: 5, type: "Long" } }
const COMPLETED = { success: true, taskId: "t-1", outcome: "completed" }
const RESOLVED = { success: true, taskId: "t-1", outcome: "resolved", assignee: "mary" }

export const TASK_WRITE_CASES: WriteCase[] = [
  {
    toolName: "camunda7_complete_task",
    title: "completes a task without form fields through /complete, converting its variables",
    args: {
      taskId: "t-1",
      variables: { ...AMOUNT, due: { value: "2026-10-01T08:30:00+02:00", type: "Date" } },
    },
    routes: taskRoutes(TASK, NO_FORM_BPMN),
    wire: [
      READ_TASK,
      READ_BPMN,
      {
        method: "POST",
        path: "/task/t-1/complete",
        body: {
          variables: { ...AMOUNT, due: { value: "2026-10-01T08:30:00.000+0200", type: "Date" } },
        },
      },
    ],
    result: COMPLETED,
  },
  {
    toolName: "camunda7_complete_task",
    title: "completes a task outside any process diagram without variables",
    args: { taskId: "t-1" },
    routes: { "GET /task/t-1": { body: { ...TASK, processDefinitionId: null } } },
    wire: [READ_TASK, { method: "POST", path: "/task/t-1/complete", body: {} }],
    result: COMPLETED,
  },
  {
    toolName: "camunda7_complete_task",
    title: "submits a form task through the form endpoint, so the engine validates its fields",
    args: {
      taskId: "t-1",
      variables: {
        ...AMOUNT,
        priority: { value: 70, type: "Long" },
        channel: { value: "mail", type: "String" },
      },
    },
    routes: taskRoutes(TASK, FORM_BPMN),
    // Every defaulted field was sent (approved is readonly): nothing to keep, nothing read.
    wire: [
      READ_TASK,
      READ_BPMN,
      {
        method: "POST",
        path: "/task/t-1/submit-form",
        body: {
          variables: {
            ...AMOUNT,
            priority: { value: 70, type: "Long" },
            channel: { value: "mail", type: "String" },
          },
        },
      },
    ],
    result: COMPLETED,
  },
  {
    toolName: "camunda7_complete_task",
    title: "sends an omitted defaulted field's current value back instead of letting it reset",
    args: { taskId: "t-1", variables: AMOUNT },
    routes: taskRoutes(TASK, FORM_BPMN, {
      priority: { type: "Long", value: 90, valueInfo: {} },
      channel: { type: "Null", value: null, valueInfo: {} },
      approved: { type: "Boolean", value: true, valueInfo: {} },
      comment: { type: "String", value: "earlier", valueInfo: {} },
    }),
    // priority keeps 90 (not its default 50); channel has no value yet, so the engine initializes it.
    wire: [
      READ_TASK,
      READ_BPMN,
      READ_VARIABLES,
      {
        method: "POST",
        path: "/task/t-1/submit-form",
        body: { variables: { ...AMOUNT, priority: { type: "Long", value: 90, valueInfo: {} } } },
      },
    ],
    result: COMPLETED,
  },
  {
    toolName: "camunda7_complete_task",
    title: "resolves a delegated task back to its owner instead of completing it",
    args: { taskId: "t-1", variables: { comment: { value: "checked", type: "String" } } },
    routes: taskRoutes(DELEGATED, NO_FORM_BPMN),
    wire: [
      READ_TASK,
      READ_BPMN,
      {
        method: "POST",
        path: "/task/t-1/resolve",
        body: { variables: { comment: { value: "checked", type: "String" } } },
      },
    ],
    result: RESOLVED,
  },
  {
    toolName: "camunda7_complete_task",
    title: "reports a delegated form task as resolved — the form endpoint resolves it",
    args: {
      taskId: "t-1",
      variables: {
        ...AMOUNT,
        priority: { value: 70, type: "Long" },
        channel: { value: "mail", type: "String" },
      },
    },
    routes: taskRoutes(DELEGATED, FORM_BPMN),
    wire: [
      READ_TASK,
      READ_BPMN,
      {
        method: "POST",
        path: "/task/t-1/submit-form",
        body: {
          variables: {
            ...AMOUNT,
            priority: { value: 70, type: "Long" },
            channel: { value: "mail", type: "String" },
          },
        },
      },
    ],
    result: RESOLVED,
  },
]
