import { z } from "zod"
import {
  firstResultParam,
  flagParam,
  maxResultsParam,
  sortOrderParam,
  variableSchema,
  wholeVariableParam,
} from "./shared.js"

export const listTasksInput = z.object({
  assignee: z.string().optional(),
  candidateGroup: z
    .string()
    .optional()
    .describe("Tasks offered to this group: only UNASSIGNED ones unless includeAssignedTasks"),
  includeAssignedTasks: z
    .boolean()
    .optional()
    .describe("With candidateGroup: include tasks already claimed"),
  processDefinitionKey: z.string().optional(),
  processInstanceId: z.string().optional(),
  unassigned: flagParam(),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z
    .enum([
      "instanceId",
      "dueDate",
      "assignee",
      "created",
      "lastUpdated",
      "description",
      "id",
      "name",
      "priority",
    ])
    .optional(),
  sortOrder: sortOrderParam,
})

export const getTaskInput = z.object({
  taskId: z.string(),
})

export const claimTaskInput = z.object({
  taskId: z.string(),
  userId: z.string(),
})

export const unclaimTaskInput = z.object({
  taskId: z.string(),
})

export const completeTaskInput = z.object({
  taskId: z.string(),
  variables: variableSchema.optional(),
})

export const setTaskAssigneeInput = z.object({
  taskId: z.string(),
  userId: z.string(),
})

export const getTaskVariablesInput = z.object({
  taskId: z.string(),
  variableName: wholeVariableParam,
})
