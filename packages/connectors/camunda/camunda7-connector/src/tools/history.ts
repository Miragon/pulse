import {
  queryHistoricProcessInstancesInput,
  queryHistoricActivityInstancesInput,
  queryHistoricTaskInstancesInput,
  queryHistoricVariableInstancesInput,
  queryHistoricIncidentsInput,
} from "@miragon/pulse-camunda7-client/schemas"
import type { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import {
  RAW_VARIABLES,
  complementaryFlags,
  engineLike,
  engineSorting,
  toOptionalEngineDate,
  trueOnly,
} from "@miragon/pulse-camunda7-client"
import {
  getHistoricProcessInstances,
  getHistoricProcessInstancesCount,
  getHistoricActivityInstances,
  getHistoricActivityInstancesCount,
  getHistoricTaskInstances,
  getHistoricTaskInstancesCount,
  getHistoricVariableInstances,
  getHistoricVariableInstancesCount,
  getHistoricIncidents,
  getHistoricIncidentsCount,
} from "@miragon/pulse-camunda7-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/pagination.js"
import type { EngineRegistry } from "../lib/resolve-engine.js"
import { truncateVariableRows, VARIABLE_TRUNCATION_NOTE } from "../lib/variable-truncation.js"
import { engineParamShape, withEngine } from "../lib/with-engine.js"

type Register = ReturnType<typeof createToolRegistrar<EngineRegistry>>

interface TimeWindow {
  startedAfter?: string
  startedBefore?: string
  finishedAfter?: string
  finishedBefore?: string
}

function engineTimeWindow(args: TimeWindow) {
  return {
    startedAfter: toOptionalEngineDate(args.startedAfter),
    startedBefore: toOptionalEngineDate(args.startedBefore),
    finishedAfter: toOptionalEngineDate(args.finishedAfter),
    finishedBefore: toOptionalEngineDate(args.finishedBefore),
  }
}

export function registerHistoryTools(register: Register) {
  register({
    name: "camunda7_query_historic_process_instances",
    category: "history",
    description:
      "Query historic process instances (completed and running) with filters. Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...queryHistoricProcessInstancesInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        processInstanceId: args.processInstanceId,
        processDefinitionKey: args.processDefinitionKey,
        processInstanceBusinessKey: args.businessKey,
        processInstanceBusinessKeyLike: engineLike(args.businessKeyLike),
        ...complementaryFlags(args, "finished", "unfinished"),
        withIncidents: trueOnly(args.withIncidents),
        incidentStatus: args.incidentStatus,
        ...engineTimeWindow(args),
      }
      const [items, count] = await Promise.all([
        getHistoricProcessInstances({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getHistoricProcessInstancesCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  register({
    name: "camunda7_query_historic_activity_instances",
    category: "history",
    description:
      "Query historic activity instances, i.e. which BPMN activities were executed in a process instance. Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...queryHistoricActivityInstancesInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        processInstanceId: args.processInstanceId,
        processDefinitionId: args.processDefinitionId,
        activityId: args.activityId,
        activityType: args.activityType,
        ...complementaryFlags(args, "finished", "unfinished"),
        canceled: trueOnly(args.canceled),
        ...engineTimeWindow(args),
      }
      const [items, count] = await Promise.all([
        getHistoricActivityInstances({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getHistoricActivityInstancesCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  register({
    name: "camunda7_query_historic_task_instances",
    category: "history",
    description:
      "Query historic task instances (completed and open user tasks). Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...queryHistoricTaskInstancesInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        processInstanceId: args.processInstanceId,
        processDefinitionKey: args.processDefinitionKey,
        taskAssignee: args.assignee,
        ...complementaryFlags(args, "finished", "unfinished"),
      }
      const [items, count] = await Promise.all([
        getHistoricTaskInstances({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getHistoricTaskInstancesCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  register({
    name: "camunda7_query_historic_variable_instances",
    category: "history",
    description:
      "Query historic variable instances, i.e. variable values from process history (serialized, with valueInfo). " +
      `${VARIABLE_TRUNCATION_NOTE} Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.`,
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...queryHistoricVariableInstancesInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        processInstanceId: args.processInstanceId,
        variableName: args.variableName,
        variableNameLike: engineLike(args.variableNameLike),
      }
      const [items, count] = await Promise.all([
        getHistoricVariableInstances({
          client,
          query: {
            ...filters,
            ...RAW_VARIABLES,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getHistoricVariableInstancesCount({ client, query: filters }),
      ])
      return toPaginatedList(truncateVariableRows(items), count, args.firstResult)
    }),
  })

  register({
    name: "camunda7_query_historic_incidents",
    category: "history",
    description:
      "Query historic incidents — open and resolved, with createTime/endTime — to tell a systemic " +
      "failure (the same activity failing across instances, since when) from a one-off; the runtime " +
      "incident list forgets resolved ones. Returns one page as { items, totalCount, hasMore, nextOffset? }. If hasMore is true, call again with firstResult = nextOffset.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { ...queryHistoricIncidentsInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        processInstanceId: args.processInstanceId,
        processDefinitionKey: args.processDefinitionKey,
        activityId: args.activityId,
        incidentType: args.incidentType,
        // True-only: the engine ignores a false (an incident may also be
        // deleted, so neither flag has a complement to send instead).
        open: trueOnly(args.open),
        resolved: trueOnly(args.resolved),
        createTimeAfter: toOptionalEngineDate(args.createTimeAfter),
        createTimeBefore: toOptionalEngineDate(args.createTimeBefore),
      }
      const [items, count] = await Promise.all([
        getHistoricIncidents({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getHistoricIncidentsCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })
}
