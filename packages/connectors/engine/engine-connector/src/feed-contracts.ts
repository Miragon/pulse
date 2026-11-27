import { z } from "zod"
import { listIncidentsInput, listProcessInstancesInput, pagingShape } from "./schemas/index.js"

/** Single source for both tool schemas and (type-only, no runtime zod) the builders and widgets. */

/** The feeds' paging (`pagingShape`, the one paging definition in `schemas/shared.ts`). */
export type PagingArgs = z.infer<z.ZodObject<typeof pagingShape>>

/**
 * A process's tenant, beside its key: the one parameter name of a tenant (as `engine_get_screen`
 * and `engine_open_cockpit` take it); without it the process the key names, none where the key has
 * a version without a tenant, else its first tenant by id.
 */
const processTenantShape = {
  tenantId: z
    .string()
    .min(1)
    .optional()
    .describe("The process's tenant; omitted: none, else the key's first tenant by id."),
}

/** One process to drill into: its key, and its tenant (`processTenantShape`). */
export const processScopeShape = {
  processDefinitionKey: z.string().describe("Process definition key to drill into"),
  ...processTenantShape,
}

/**
 * The tenant a list of a key's runs is narrowed to (`ListTenant`): the runs in it, null for those
 * in none; omitted, the key spans every tenant, as `processDefinitionKey` does on every tool. A
 * name of its own, so `tenantId` keeps its one meaning, a process's tenant.
 */
const listTenantShape = {
  onlyTenant: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Beside processDefinitionKey: the runs in this tenant, null: in none."),
}

const processInstancesFilterShape = {
  processDefinitionKey: z
    .string()
    .optional()
    .describe(
      "Process definition key whose instances to list. Omit for ALL running instances engine-wide.",
    ),
  ...listTenantShape,
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
const instanceSearchShape = {
  search: z
    .string()
    .optional()
    .describe(
      "Search box: business key (substring) or whole process instance id. Replaces businessKeyLike.",
    ),
}
export type InstanceSearchArgs = z.infer<z.ZodObject<typeof instanceSearchShape>>

/** The instance list's feed: a key's instances (in one tenant where a process opened them), paged. */
export const processInstancesFeedShape = {
  ...processInstancesFilterShape,
  ...instanceSearchShape,
  ...pagingShape,
}

export const jobsFilterShape = {
  processDefinitionKey: z.string().optional().describe("Filter by process definition key"),
  ...listTenantShape,
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
    .describe("Narrow the incident list by business key or id (substring; % wildcards allowed)."),
}
export type ClusterDetailFilters = z.infer<z.ZodObject<typeof clusterDetailFilterShape>>

/** An activity's page of incidents: which activity, the cursor of the page before, its size. */
export const activityIncidentsPageShape = {
  processDefinitionKey: z.string().describe("Process definition key"),
  ...processTenantShape,
  activityId: z.string().describe("Activity id whose incidents to page"),
  after: z.string().min(1).optional().describe("The cursor of the page before, from its next."),
  maxResults: pagingShape.maxResults,
}
export type ActivityIncidentsPageArgs = z.infer<z.ZodObject<typeof activityIncidentsPageShape>>

export const activityStatisticsShape = {
  processDefinitionKey: z.string().describe("Process definition key"),
  ...processTenantShape,
  source: z
    .enum(["runtime", "history"])
    .describe(
      "runtime = what runs at each element now, summed over every deployed version of the process; history = what the instances started in the last 30 days passed (history level activity or higher)",
    ),
}
export type ActivityStatisticsArgs = z.infer<z.ZodObject<typeof activityStatisticsShape>>
