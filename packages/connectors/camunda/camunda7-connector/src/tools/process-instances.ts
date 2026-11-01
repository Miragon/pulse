import {
  startProcessInstanceInput,
  listProcessInstancesInput,
  getProcessInstanceInput,
  getActivityInstanceTreeInput,
  deleteProcessInstanceInput,
  modifyProcessInstanceInput,
  getProcessInstanceVariablesInput,
  setProcessInstanceVariableInput,
  setProcessInstanceSuspensionInput,
} from "@miragon/pulse-camunda7-client/schemas"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import {
  complementaryFlags,
  engineLike,
  engineSorting,
  readProcessInstanceVariables,
  trueOnly,
  toEngineVariable,
  toEngineVariables,
} from "@miragon/pulse-camunda7-client"
import {
  startProcessInstanceByKey,
  getProcessInstances,
  getProcessInstancesCount,
  getProcessInstance,
  deleteProcessInstance,
  modifyProcessInstance,
  getActivityInstanceTree,
  setProcessInstanceVariable,
  updateSuspensionStateById,
} from "@miragon/pulse-camunda7-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/pagination.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import {
  CUT_VALUE_WRITE_RULE,
  VARIABLE_TRUNCATION_NOTE,
  variableRead,
} from "../lib/variable-truncation.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

export function registerProcessInstanceTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "camunda7_start_process_instance",
    category: "process-instances",
    description:
      "Start a new process instance by process definition key. Optionally set a business key and initial variables.",
    annotations: { destructiveHint: false, openWorldHint: true },
    inputSchema: { ...startProcessInstanceInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      startProcessInstanceByKey({
        client,
        path: { key: args.processDefinitionKey },
        body: {
          businessKey: args.businessKey,
          variables: toEngineVariables(args.variables),
        },
      }),
    ),
  })

  register({
    name: "camunda7_list_process_instances",
    category: "process-instances",
    description:
      "List running process instances with optional filters. Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...listProcessInstancesInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        processDefinitionKey: args.processDefinitionKey,
        businessKey: args.businessKey,
        businessKeyLike: engineLike(args.businessKeyLike),
        ...complementaryFlags(args, "active", "suspended"),
        withIncident: trueOnly(args.withIncidents),
      }
      const [items, count] = await Promise.all([
        getProcessInstances({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getProcessInstancesCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  register({
    name: "camunda7_get_process_instance",
    category: "process-instances",
    description: "Get details of a single process instance by ID.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getProcessInstanceInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      getProcessInstance({ client, path: { id: args.processInstanceId } }),
    ),
  })

  register({
    name: "camunda7_get_activity_instance_tree",
    category: "process-instances",
    description:
      "Get the activity instance tree of a running process instance. Shows which activities are currently active.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getActivityInstanceTreeInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      getActivityInstanceTree({ client, path: { id: args.processInstanceId } }),
    ),
  })

  register({
    name: "camunda7_delete_process_instance",
    category: "process-instances",
    description:
      "Delete (cancel) a running process instance by ID. Irreversible; cascades to the instances its call activities " +
      "started (unless skipSubprocesses) and cancels the calling activity if it was itself called.",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...deleteProcessInstanceInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await deleteProcessInstance({
        client,
        path: { id: args.processInstanceId },
        query: {
          skipSubprocesses: args.skipSubprocesses,
          skipCustomListeners: args.skipCustomListeners,
          skipIoMappings: args.skipIoMappings,
        },
      })
      return { success: true, processInstanceId: args.processInstanceId }
    }),
  })

  register({
    name: "camunda7_modify_process_instance",
    category: "process-instances",
    description:
      "Modify a running process instance by moving tokens. Supports cancel, startBeforeActivity, startAfterActivity, and startTransition instructions.",
    annotations: { destructiveHint: true, openWorldHint: true },
    inputSchema: { ...modifyProcessInstanceInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await modifyProcessInstance({
        client,
        path: { id: args.processInstanceId },
        body: {
          skipCustomListeners: args.skipCustomListeners,
          skipIoMappings: args.skipIoMappings,
          instructions: args.instructions,
        },
      })
      return { success: true, processInstanceId: args.processInstanceId }
    }),
  })

  register({
    name: "camunda7_get_process_instance_variables",
    category: "process-instances",
    description: `Get all variables of a process instance (Json/Xml/Object: serialized string + valueInfo). ${VARIABLE_TRUNCATION_NOTE}`,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...getProcessInstanceVariablesInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) =>
      variableRead(
        await readProcessInstanceVariables(client, args.processInstanceId),
        args.variableName,
      ),
    ),
  })

  register({
    name: "camunda7_set_process_instance_variable",
    category: "process-instances",
    description: `Set a single variable on a process instance. An Object needs valueInfo.objectTypeName (pass back the valueInfo read). ${CUT_VALUE_WRITE_RULE}`,
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...setProcessInstanceVariableInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await setProcessInstanceVariable({
        client,
        path: { id: args.processInstanceId, varName: args.variableName },
        body: toEngineVariable(args.variableName, {
          value: args.value,
          type: args.type,
          valueInfo: args.valueInfo,
        }),
      })
      return {
        success: true,
        processInstanceId: args.processInstanceId,
        variableName: args.variableName,
      }
    }),
  })

  register({
    name: "camunda7_set_process_instance_suspension",
    category: "process-instances",
    description:
      "Set the suspension state of a process instance. suspended=true suspends it (jobs, timers, and message correlations are frozen); suspended=false activates (unsuspends) it again.",
    annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...setProcessInstanceSuspensionInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await updateSuspensionStateById({
        client,
        path: { id: args.processInstanceId },
        body: { suspended: args.suspended },
      })
      return {
        success: true,
        processInstanceId: args.processInstanceId,
        suspended: args.suspended,
      }
    }),
  })
}
