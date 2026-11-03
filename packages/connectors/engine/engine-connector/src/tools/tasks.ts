import {
  listTasksInput,
  getTaskInput,
  claimTaskInput,
  unclaimTaskInput,
  completeTaskInput,
  setTaskAssigneeInput,
  getTaskVariablesInput,
} from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { readTaskVariables } from "@miragon/pulse-engine-client"
import { complementaryFlags, engineSorting, trueOnly } from "@miragon/pulse-engine-core"
import {
  getTasks,
  getTasksCount,
  getTask,
  claim,
  unclaim,
  setAssignee,
} from "@miragon/pulse-engine-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/mcp/pagination.js"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { CUT_VALUE_WRITE_RULE, variableRead } from "../lib/mcp/variable-truncation.js"
import { completeUserTask } from "../lib/bpmn/complete-user-task.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"

export function registerTaskTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "engine_list_tasks",
    category: "tasks",
    description:
      "List user tasks. Each task carries ID, name, assignee, process info, and timestamps.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...listTasksInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        assignee: args.assignee,
        candidateGroup: args.candidateGroup,
        // The engine refuses includeAssignedTasks without a candidate filter.
        includeAssignedTasks: args.candidateGroup ? trueOnly(args.includeAssignedTasks) : undefined,
        processDefinitionKey: args.processDefinitionKey,
        processInstanceId: args.processInstanceId,
        ...complementaryFlags({ unassigned: args.unassigned }, "unassigned", "assigned"),
      }
      const [items, count] = await Promise.all([
        getTasks({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getTasksCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  register({
    name: "engine_get_task",
    category: "tasks",
    description: "Get details of a single user task by ID.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getTaskInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => getTask({ client, path: { id: args.taskId } })),
  })

  register({
    name: "engine_claim_task",
    category: "tasks",
    description: "Claim a user task for a specific user.",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...claimTaskInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await claim({
        client,
        path: { id: args.taskId },
        body: { userId: args.userId },
      })
      return { success: true, taskId: args.taskId, userId: args.userId }
    }),
  })

  register({
    name: "engine_unclaim_task",
    category: "tasks",
    description: "Unclaim (release) a user task, removing the current assignee.",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...unclaimTaskInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await unclaim({ client, path: { id: args.taskId } })
      return { success: true, taskId: args.taskId }
    }),
  })

  register({
    name: "engine_complete_task",
    category: "tasks",
    description:
      "Complete a user task by ID, optionally setting variables. A task with form fields is submitted as its form: " +
      "the engine enforces them (required, readonly, types); omitted fields keep their value. A delegated task " +
      '(delegationState PENDING) is resolved back to its owner instead and stays open (outcome "resolved"). ' +
      CUT_VALUE_WRITE_RULE,
    annotations: { destructiveHint: false, openWorldHint: true },
    inputSchema: { ...completeTaskInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      completeUserTask(client, args.taskId, args.variables),
    ),
  })

  register({
    name: "engine_set_task_assignee",
    category: "tasks",
    description: "Set the assignee of a user task.",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...setTaskAssigneeInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await setAssignee({
        client,
        path: { id: args.taskId },
        body: { userId: args.userId },
      })
      return { success: true, taskId: args.taskId, userId: args.userId }
    }),
  })

  register({
    name: "engine_get_task_variables",
    category: "tasks",
    description:
      "Get all variables of a user task (Json/Xml/Object: serialized string + valueInfo).",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getTaskVariablesInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      variableRead(await readTaskVariables(client, args.taskId), args.variableName),
    ),
  })
}
