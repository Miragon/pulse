import {
  startProcessInstanceInput,
  listProcessInstancesInput,
  inspectProcessInstanceInput,
  getActivityInstanceTreeInput,
  deleteProcessInstanceInput,
  modifyProcessInstanceInput,
  getProcessInstanceVariablesInput,
  setProcessInstanceVariableInput,
  setProcessInstanceSuspensionInput,
} from "../schemas/index.js"
import type { ToolRegistrar } from "@miragon/pulse-widget-shell/server"
import { readProcessInstanceVariables } from "@miragon/pulse-engine-client"
import {
  complementaryFlags,
  engineLike,
  engineSorting,
  trueOnly,
  toEngineVariable,
  toEngineVariables,
} from "@miragon/pulse-engine-core"
import {
  startProcessInstanceByKey,
  getProcessInstances,
  getProcessInstancesCount,
  deleteProcessInstance,
  modifyProcessInstance,
  getActivityInstanceTree,
  setProcessInstanceVariable,
  updateSuspensionStateById,
} from "@miragon/pulse-engine-client/sdk"
import { inspectForModel } from "../lib/core-adapter/composites.js"
import { paginatedListOutput, toPaginatedList } from "../lib/mcp/pagination.js"
import type { EngineRegistry } from "../lib/engine/resolve-engine.js"
import { CUT_VALUE_WRITE_RULE, variableRead } from "../lib/mcp/variable-truncation.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"

export function registerProcessInstanceTools(register: ToolRegistrar<EngineRegistry>) {
  register({
    name: "engine_start_process_instance",
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
    name: "engine_list_process_instances",
    category: "process-instances",
    description: "List running process instances.",
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
    name: "engine_inspect_process_instance",
    category: "process-instances",
    description:
      "Where one process instance waits and why, running or ended: root-cause incidents, called " +
      "instances. Select by processInstanceId, businessKey or processDefinitionKey.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...inspectProcessInstanceInput.shape, ...engineParamShape },
    handler: withEngine((client, args, { engineId }) => inspectForModel(client, args, engineId)),
  })

  register({
    name: "engine_get_activity_instance_tree",
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
    name: "engine_delete_process_instance",
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
    name: "engine_modify_process_instance",
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
    name: "engine_get_process_instance_variables",
    category: "process-instances",
    description:
      "Get all variables of a process instance (Json/Xml/Object: serialized string + valueInfo).",
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
    name: "engine_set_process_instance_variable",
    category: "process-instances",
    // The Object rule (valueInfo.objectTypeName) is the instructions' variable input rule;
    // `toEngineVariable` names it when it is missing.
    description: `Set a single variable on a process instance; pass back the valueInfo read. ${CUT_VALUE_WRITE_RULE}`,
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
    name: "engine_set_process_instance_suspension",
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
