import { z } from "zod"
import {
  engineDateParam,
  firstResultParam,
  flagParam,
  likeParam,
  maxResultsParam,
  sortOrderParam,
} from "./shared.js"

/**
 * finished/unfinished: complementary engine flags (`complementaryFlags`), a
 * pair the camunda7 module instructions name.
 */
const finishedFlags = {
  finished: flagParam(),
  unfinished: flagParam(),
}

/** Start/end time windows of a historic query; ISO 8601 in, engine format out. */
const timeWindow = {
  startedAfter: engineDateParam(),
  startedBefore: engineDateParam(),
  finishedAfter: engineDateParam(),
  finishedBefore: engineDateParam(),
}

export const queryHistoricProcessInstancesInput = z.object({
  processInstanceId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  businessKey: z.string().optional(),
  businessKeyLike: likeParam(),
  ...finishedFlags,
  withIncidents: flagParam("true = only instances that had an incident (open or resolved)"),
  incidentStatus: z.enum(["open", "resolved"]).optional(),
  ...timeWindow,
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z
    .enum([
      "instanceId",
      "definitionId",
      "definitionKey",
      "definitionName",
      "startTime",
      "endTime",
      "duration",
      "tenantId",
      "businessKey",
    ])
    .optional(),
  sortOrder: sortOrderParam,
})

export const queryHistoricActivityInstancesInput = z.object({
  processInstanceId: z.string().optional(),
  processDefinitionId: z.string().optional().describe("This engine query has no key filter"),
  activityId: z.string().optional(),
  activityType: z.string().optional().describe("e.g. userTask, serviceTask"),
  ...finishedFlags,
  canceled: flagParam(),
  ...timeWindow,
  firstResult: firstResultParam,
  maxResults: maxResultsParam(50),
  sortBy: z
    .enum([
      "activityInstanceId",
      "instanceId",
      "executionId",
      "activityId",
      "activityName",
      "activityType",
      "startTime",
      "endTime",
      "duration",
      "tenantId",
    ])
    .optional(),
  sortOrder: sortOrderParam,
})

export const queryHistoricTaskInstancesInput = z.object({
  processInstanceId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  assignee: z.string().optional(),
  ...finishedFlags,
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z
    .enum([
      "taskId",
      "activityInstanceId",
      "processDefinitionId",
      "processInstanceId",
      "executionId",
      "duration",
      "endTime",
      "startTime",
      "taskName",
      "taskDescription",
      "assignee",
      "owner",
      "dueDate",
      "followUpDate",
      "deleteReason",
      "taskDefinitionKey",
      "priority",
      "tenantId",
    ])
    .optional(),
  sortOrder: sortOrderParam,
})

/**
 * `variableName` here is a plain filter: unlike the runtime reads' `wholeVariableParam`, a
 * history value stays cut (`truncateVariableRows`), so the field says so.
 */
export const queryHistoricVariableInstancesInput = z.object({
  processInstanceId: z.string().optional(),
  variableName: z.string().optional().describe("Values stay cut, even for one name"),
  variableNameLike: likeParam(),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(50),
  sortBy: z.enum(["instanceId", "variableName", "tenantId"]).optional(),
  sortOrder: sortOrderParam,
})

/**
 * Historic incidents (`GET /history/incident`): open AND resolved ones with
 * their create/end timestamps — the recurrence and "since when" questions the
 * runtime incident list cannot answer once an incident is resolved. The
 * `open`/`resolved` filters are TRUE-ONLY (`trueOnly`): an incident can also be
 * deleted, so neither is the other's complement, and the engine ignores a
 * `false` — the tool drops it instead of claiming a filter.
 */
export const queryHistoricIncidentsInput = z.object({
  processInstanceId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  activityId: z.string().optional(),
  incidentType: z.string().optional(),
  open: flagParam(),
  resolved: flagParam(),
  createTimeAfter: engineDateParam(),
  createTimeBefore: engineDateParam(),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z
    .enum([
      "createTime",
      "endTime",
      "incidentType",
      "activityId",
      "processInstanceId",
      "processDefinitionKey",
    ])
    .optional(),
  sortOrder: sortOrderParam,
})
