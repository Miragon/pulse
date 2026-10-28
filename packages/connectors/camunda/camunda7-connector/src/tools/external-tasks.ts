import {
  listExternalTasksInput,
  setExternalTaskRetriesInput,
  fetchAndLockInput,
  completeExternalTaskInput,
  handleExternalTaskFailureInput,
} from "@miragon/pulse-camunda7-client/schemas"
import type { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import {
  complementaryFlags,
  engineSorting,
  toEngineVariables,
} from "@miragon/pulse-camunda7-client"
import {
  getExternalTasks,
  getExternalTasksCount,
  setExternalTaskResourceRetries,
  fetchAndLock,
  completeExternalTaskResource,
  handleFailure,
} from "@miragon/pulse-camunda7-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/pagination.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

type Register = ReturnType<typeof createToolRegistrar<EngineRegistry>>

export function registerExternalTaskTools(register: Register) {
  register({
    name: "camunda7_list_external_tasks",
    category: "external-tasks",
    description:
      "List external tasks (service-task work handed to external workers) with optional filters — topic, worker, " +
      "lock state, retries, process instance/definition, activity. Read-only: it never locks, completes or fails a task " +
      "(noRetriesLeft finds the failed ones; where the toolset allows engine writes, camunda7_set_external_task_retries " +
      "hands them back to their workers). " +
      "Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...listExternalTasksInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        topicName: args.topicName,
        workerId: args.workerId,
        ...complementaryFlags(args, "locked", "notLocked"),
        ...complementaryFlags(args, "withRetriesLeft", "noRetriesLeft"),
        processInstanceId: args.processInstanceId,
        processDefinitionKey: args.processDefinitionKey,
        activityId: args.activityId,
      }
      const [items, count] = await Promise.all([
        getExternalTasks({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getExternalTasksCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  // Never acts AS the worker, so it stays in operations.
  register({
    name: "camunda7_set_external_task_retries",
    category: "external-tasks",
    description:
      "Set the retries of an external task. Retries > 0 hand a failed task back to its workers and clear its " +
      "failedExternalTask incident (camunda7_resolve_incident cannot resolve that incident type); 0 raises an incident. " +
      "Never locks, completes or fails the task itself.",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...setExternalTaskRetriesInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await setExternalTaskResourceRetries({
        client,
        path: { id: args.externalTaskId },
        body: { retries: args.retries },
      })
      return { success: true, externalTaskId: args.externalTaskId, retries: args.retries }
    }),
  })

  // Admin-only below: these act on a task as if they were the production worker.

  register({
    name: "camunda7_fetch_and_lock",
    category: "external-tasks",
    description:
      "External-task WORKER protocol: fetch and lock external tasks for the given worker id. Locked tasks are withheld " +
      "from the production workers until the lock expires (default 5 minutes) or the task is completed or failed — " +
      "there is no unlock. To inspect external tasks without locking them, use camunda7_list_external_tasks.",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...fetchAndLockInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      fetchAndLock({
        client,
        body: {
          workerId: args.workerId,
          maxTasks: args.maxTasks,
          topics: args.topics,
        },
      }),
    ),
  })

  register({
    name: "camunda7_complete_external_task",
    category: "external-tasks",
    description:
      "External-task WORKER protocol: complete an external task that was previously fetched and locked by the given " +
      "worker, optionally setting variables — the process continues as if the worker had done the work.",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...completeExternalTaskInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await completeExternalTaskResource({
        client,
        path: { id: args.externalTaskId },
        body: {
          workerId: args.workerId,
          variables: toEngineVariables(args.variables),
        },
      })
      return { success: true, externalTaskId: args.externalTaskId }
    }),
  })

  register({
    name: "camunda7_handle_external_task_failure",
    category: "external-tasks",
    description:
      "External-task WORKER protocol: report a failure for an external task locked by the given worker. Sets the error " +
      "message, the REQUIRED remaining retries and the retry timeout; retries = 0 raises an incident at once.",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...handleExternalTaskFailureInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await handleFailure({
        client,
        path: { id: args.externalTaskId },
        body: {
          workerId: args.workerId,
          errorMessage: args.errorMessage,
          errorDetails: args.errorDetails,
          retries: args.retries,
          retryTimeout: args.retryTimeout,
        },
      })
      return { success: true, externalTaskId: args.externalTaskId }
    }),
  })
}
