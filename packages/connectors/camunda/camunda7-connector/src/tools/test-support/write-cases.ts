/** `write-tools.wire.test.ts` fails when a write tool has no case here. */
import type { FakeRoutes } from "./fake-engine.js"

export interface WireRequest {
  method: string
  path: string
  query?: Record<string, string>
  /** `"multipart"`: asserted in deployments.test.ts. */
  body?: unknown
}

export interface WriteCase {
  toolName: string
  title: string
  args: Record<string, unknown>
  routes?: FakeRoutes
  wire: WireRequest[]
  result?: unknown
}

const OBJECT_INFO = {
  objectTypeName: "java.util.ArrayList<java.lang.Integer>",
  serializationDataFormat: "application/json",
}

/** Process instances, tasks (complete_task: `write-cases-tasks.ts`), messages and signals. */
export const RUNTIME_WRITE_CASES: WriteCase[] = [
  {
    toolName: "camunda7_start_process_instance",
    title: "serializes Json, converts ISO dates, keeps plain values",
    args: {
      processDefinitionKey: "invoice",
      businessKey: "bk-1",
      variables: {
        amount: { value: 5, type: "Long" },
        payload: { value: { a: 1 }, type: "Json" },
        due: { value: "2026-10-01T08:30:00Z", type: "Date" },
      },
    },
    routes: { "POST /process-definition/key/invoice/start": { body: { id: "pi-1" } } },
    wire: [
      {
        method: "POST",
        path: "/process-definition/key/invoice/start",
        body: {
          businessKey: "bk-1",
          variables: {
            amount: { value: 5, type: "Long" },
            payload: { value: '{"a":1}', type: "Json" },
            due: { value: "2026-10-01T08:30:00.000+0000", type: "Date" },
          },
        },
      },
    ],
    result: { id: "pi-1" },
  },
  {
    toolName: "camunda7_delete_process_instance",
    title: "sends the engine defaults (cascade incl. subprocesses) when no skip flag is set",
    args: { processInstanceId: "pi-1" },
    wire: [{ method: "DELETE", path: "/process-instance/pi-1" }],
    result: { success: true, processInstanceId: "pi-1" },
  },
  {
    toolName: "camunda7_delete_process_instance",
    title: "forwards the skip flags as query parameters",
    args: {
      processInstanceId: "pi-1",
      skipSubprocesses: true,
      skipCustomListeners: true,
      skipIoMappings: false,
    },
    wire: [
      {
        method: "DELETE",
        path: "/process-instance/pi-1",
        query: { skipSubprocesses: "true", skipCustomListeners: "true", skipIoMappings: "false" },
      },
    ],
  },
  {
    toolName: "camunda7_modify_process_instance",
    title: "posts the instructions and skip flags",
    args: {
      processInstanceId: "pi-1",
      skipIoMappings: true,
      instructions: [
        { type: "cancel", activityInstanceId: "ai-1" },
        { type: "startBeforeActivity", activityId: "A2" },
      ],
    },
    wire: [
      {
        method: "POST",
        path: "/process-instance/pi-1/modification",
        body: {
          skipIoMappings: true,
          instructions: [
            { type: "cancel", activityInstanceId: "ai-1" },
            { type: "startBeforeActivity", activityId: "A2" },
          ],
        },
      },
    ],
    result: { success: true, processInstanceId: "pi-1" },
  },
  {
    toolName: "camunda7_set_process_instance_variable",
    title: "stringifies a parsed Json value",
    args: { processInstanceId: "pi-1", variableName: "payload", value: { a: 2 }, type: "Json" },
    wire: [
      {
        method: "PUT",
        path: "/process-instance/pi-1/variables/payload",
        body: { value: '{"a":2}', type: "Json" },
      },
    ],
    result: { success: true, processInstanceId: "pi-1", variableName: "payload" },
  },
  {
    toolName: "camunda7_set_process_instance_variable",
    title: "writes an Object back serialized with the valueInfo it was read with",
    args: {
      processInstanceId: "pi-1",
      variableName: "obj",
      value: "[1,2,3]",
      type: "Object",
      valueInfo: OBJECT_INFO,
    },
    wire: [
      {
        method: "PUT",
        path: "/process-instance/pi-1/variables/obj",
        body: { value: "[1,2,3]", type: "Object", valueInfo: OBJECT_INFO },
      },
    ],
  },
  {
    toolName: "camunda7_set_process_instance_variable",
    title: "converts an ISO 8601 Date to the engine format",
    args: { processInstanceId: "pi-1", variableName: "due", value: "2026-10-01", type: "Date" },
    wire: [
      {
        method: "PUT",
        path: "/process-instance/pi-1/variables/due",
        body: { value: "2026-10-01T00:00:00.000+0000", type: "Date" },
      },
    ],
  },
  {
    toolName: "camunda7_set_process_instance_suspension",
    title: "puts the target suspension state",
    args: { processInstanceId: "pi-1", suspended: true },
    wire: [{ method: "PUT", path: "/process-instance/pi-1/suspended", body: { suspended: true } }],
    result: { success: true, processInstanceId: "pi-1", suspended: true },
  },
  {
    toolName: "camunda7_claim_task",
    title: "claims for the given user",
    args: { taskId: "t-1", userId: "demo" },
    wire: [{ method: "POST", path: "/task/t-1/claim", body: { userId: "demo" } }],
    result: { success: true, taskId: "t-1", userId: "demo" },
  },
  {
    toolName: "camunda7_unclaim_task",
    title: "unclaims without a body",
    args: { taskId: "t-1" },
    wire: [{ method: "POST", path: "/task/t-1/unclaim" }],
    result: { success: true, taskId: "t-1" },
  },
  {
    toolName: "camunda7_set_task_assignee",
    title: "sets the assignee",
    args: { taskId: "t-1", userId: "demo" },
    wire: [{ method: "POST", path: "/task/t-1/assignee", body: { userId: "demo" } }],
    result: { success: true, taskId: "t-1", userId: "demo" },
  },
  {
    toolName: "camunda7_correlate_message",
    title: "targets one process instance and serializes its variables",
    args: {
      messageName: "PaymentReceived",
      processInstanceId: "pi-1",
      processVariables: { receipt: { value: { no: 7 }, type: "Json" } },
    },
    routes: { "POST /message": { body: [{ resultType: "Execution" }] } },
    wire: [
      {
        method: "POST",
        path: "/message",
        body: {
          messageName: "PaymentReceived",
          processInstanceId: "pi-1",
          processVariables: { receipt: { value: '{"no":7}', type: "Json" } },
          resultEnabled: true,
        },
      },
    ],
    result: [{ resultType: "Execution" }],
  },
  {
    toolName: "camunda7_correlate_message",
    title: "correlates to every match with all=true",
    args: { messageName: "PaymentReceived", businessKey: "bk-1", all: true, resultEnabled: false },
    wire: [
      {
        method: "POST",
        path: "/message",
        body: {
          messageName: "PaymentReceived",
          businessKey: "bk-1",
          all: true,
          resultEnabled: false,
        },
      },
    ],
  },
  {
    toolName: "camunda7_throw_signal",
    title: "broadcasts the signal with serialized variables",
    args: { name: "Shutdown", variables: { at: { value: "2026-10-01", type: "Date" } } },
    wire: [
      {
        method: "POST",
        path: "/signal",
        body: {
          name: "Shutdown",
          variables: { at: { value: "2026-10-01T00:00:00.000+0000", type: "Date" } },
        },
      },
    ],
    result: { success: true, signalName: "Shutdown" },
  },
]
