import { z } from "zod"
import {
  engineDateParam,
  firstResultParam,
  flagParam,
  maxResultsParam,
  sortOrderParam,
} from "./shared.js"

export const listJobsInput = z.object({
  processInstanceId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  activityId: z.string().optional(),
  withRetriesLeft: flagParam(),
  noRetriesLeft: flagParam(),
  active: flagParam(),
  suspended: flagParam(),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z
    .enum([
      "jobId",
      "executionId",
      "processInstanceId",
      "processDefinitionId",
      "processDefinitionKey",
      "jobPriority",
      "jobRetries",
      "jobDueDate",
      "tenantId",
    ])
    .optional(),
  sortOrder: sortOrderParam,
})

export const setJobRetriesInput = z.object({
  jobId: z.string(),
  retries: z.number().int().min(0),
})

export const setJobRetriesBatchInput = z.object({
  jobIds: z.array(z.string()).min(1),
  retries: z.number().int().min(0),
  dueDate: engineDateParam("New due date; a past one runs the jobs at once"),
})

/**
 * A job's exception stacktrace (`GET /job/{id}/stacktrace`, read via
 * c7-client's SDK-bound read `fetchJobStacktrace`), the failure detail
 * `engine_list_jobs` only summarises as `exceptionMessage`.
 */
export const getJobStacktraceInput = z.object({
  jobId: z.string().min(1),
})
