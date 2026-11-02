import { z } from "zod"
import {
  firstResultParam,
  flagParam,
  maxResultsParam,
  sortOrderParam,
  variableSchema,
} from "./shared.js"

/**
 * Read-only external-task query (`GET /external-task`) — inspects what the
 * workers see without locking, completing or failing anything. The boolean
 * filters are TRUE-ONLY on the engine side (`false` matches every task), so
 * the tool sends a `false` as its complement (locked/notLocked,
 * withRetriesLeft/noRetriesLeft — `complementaryFlags`). Each flag says what
 * `true` selects; the camunda7 module instructions say once that `false`
 * selects the other side of its pair.
 */
export const listExternalTasksInput = z.object({
  topicName: z.string().optional(),
  workerId: z.string().optional().describe("The worker that most recently locked the task"),
  locked: flagParam("true = only tasks locked now (lock not expired)"),
  notLocked: flagParam("true = only tasks not locked (no lock, or it expired)"),
  withRetriesLeft: flagParam("true = only tasks with retries > 0 (or not set yet)"),
  noRetriesLeft: flagParam("true = only failed tasks (0 retries, an incident exists)"),
  processInstanceId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  activityId: z.string().optional(),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z
    .enum([
      "id",
      "lockExpirationTime",
      "processInstanceId",
      "processDefinitionId",
      "processDefinitionKey",
      "taskPriority",
      "tenantId",
    ])
    .optional(),
  sortOrder: sortOrderParam,
})

/**
 * Per-task retries (`PUT /external-task/{id}/retries`) — the operations-level
 * recovery for a failed external task: retries > 0 hand it back to its
 * workers and clear its `failedExternalTask` incident (which
 * `camunda7_resolve_incident` cannot resolve); 0 raises one.
 */
export const setExternalTaskRetriesInput = z.object({
  externalTaskId: z.string(),
  retries: z.number().int().min(0),
})

export const fetchAndLockInput = z.object({
  workerId: z.string(),
  maxTasks: z.number().int().positive().default(10),
  topics: z.array(
    z.object({
      topicName: z.string(),
      lockDuration: z.number().int().positive().default(300000).describe("In milliseconds"),
      variables: z
        .array(z.string())
        .optional()
        .describe("Variable names to include in the response"),
    }),
  ),
})

export const completeExternalTaskInput = z.object({
  externalTaskId: z.string(),
  workerId: z.string(),
  variables: variableSchema.optional(),
})

export const handleExternalTaskFailureInput = z.object({
  externalTaskId: z.string(),
  workerId: z.string(),
  errorMessage: z.string().optional(),
  errorDetails: z.string().optional(),
  // Required: the engine reads an omitted `retries` as 0 — an incident at
  // once, and the retryTimeout is ignored.
  retries: z.number().int().min(0),
  retryTimeout: z.number().int().min(0).optional().describe("In milliseconds"),
})
