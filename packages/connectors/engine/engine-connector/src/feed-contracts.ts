import { z } from "zod"
import type { pagingShape } from "./schemas/index.js"
import { listIncidentsInput, listProcessInstancesInput } from "./schemas/index.js"

/** Single source for both tool schemas and (type-only, no runtime zod) the builders and widgets. */

/** The feeds' paging (`pagingShape`, the one paging definition in `schemas/shared.ts`). */
export type PagingArgs = z.infer<z.ZodObject<typeof pagingShape>>

export const processInstancesFilterShape = {
  processDefinitionKey: z
    .string()
    .optional()
    .describe(
      "Process definition key whose instances to list. Omit for ALL running instances engine-wide.",
    ),
  active: z
    .boolean()
    .optional()
    .describe("true = only running (non-suspended) instances, false = only suspended."),
  suspended: z
    .boolean()
    .optional()
    .describe("true = only suspended instances, false = only running."),
  withIncidents: z
    .boolean()
    .optional()
    .describe("true = only instances that currently have an open incident."),
  businessKeyLike: z
    .string()
    .optional()
    .describe("Filter by business key (substring; % wildcards allowed)."),
}
export type ProcessInstancesFilters = z.infer<z.ZodObject<typeof processInstancesFilterShape>>

/** Feed only: a business key fragment or the whole id (the engine has no LIKE on ids); replaces `businessKeyLike`. */
export const instanceSearchShape = {
  search: z
    .string()
    .optional()
    .describe(
      "Search box: business key (substring) or whole process instance id. Replaces businessKeyLike.",
    ),
}
export type InstanceSearchArgs = z.infer<z.ZodObject<typeof instanceSearchShape>>

export const jobsFilterShape = {
  processDefinitionKey: z.string().optional().describe("Filter by process definition key"),
  failedOnly: z.boolean().optional().describe("Show only failed jobs (no retries left)"),
}
export type JobsFilters = z.infer<z.ZodObject<typeof jobsFilterShape>>

// From the tool input schemas so the field types stay in one place.
export const incidentsDashboardFilterShape = {
  processDefinitionKey: listProcessInstancesInput.shape.processDefinitionKey,
  incidentType: listIncidentsInput.shape.incidentType,
}
export type IncidentsDashboardFilters = z.infer<z.ZodObject<typeof incidentsDashboardFilterShape>>

export const clusterDetailFilterShape = {
  activityId: z.string().describe("Activity id of the failure cluster."),
  incidentType: z.string().describe('Incident type of the cluster, e.g. "failedJob".'),
  messageSignature: z
    .string()
    .optional()
    .describe(
      "Normalized failure-message signature (as produced by the engine-health clusters). Omitted → all messages for this activity + type.",
    ),
  businessKeyLike: z
    .string()
    .optional()
    .describe(
      "Narrow the affected-instance list by business key (substring; % wildcards allowed).",
    ),
}
export type ClusterDetailFilters = z.infer<z.ZodObject<typeof clusterDetailFilterShape>>

export const activityIncidentsFilterShape = {
  processDefinitionKey: z.string().describe("Process definition key"),
  activityId: z.string().describe("Activity id whose incidents to page"),
}
export type ActivityIncidentsFilters = z.infer<z.ZodObject<typeof activityIncidentsFilterShape>>

export const activityStatisticsShape = {
  processDefinitionKey: z.string().describe("Process definition key"),
  source: z
    .enum(["runtime"])
    .describe("runtime = what runs at each element now, summed over every deployed version"),
}
export type ActivityStatisticsArgs = z.infer<z.ZodObject<typeof activityStatisticsShape>>
