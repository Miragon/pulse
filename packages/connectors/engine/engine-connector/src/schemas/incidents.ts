import { z } from "zod"
import { engineDateParam, firstResultParam, maxResultsParam, sortOrderParam } from "./shared.js"

export const listIncidentsInput = z.object({
  processInstanceId: z.string().optional(),
  processDefinitionKey: z.string().optional(),
  processDefinitionKeyIn: z.array(z.string()).optional(),
  processDefinitionId: z.string().optional(),
  activityId: z.string().optional(),
  incidentType: z.string().optional(),
  incidentTimestampAfter: engineDateParam(),
  incidentTimestampBefore: engineDateParam(),
  firstResult: firstResultParam,
  maxResults: maxResultsParam(),
  sortBy: z
    .enum([
      "incidentId",
      "incidentMessage",
      "incidentTimestamp",
      "incidentType",
      "executionId",
      "activityId",
      "processInstanceId",
      "processDefinitionId",
      "causeIncidentId",
      "rootCauseIncidentId",
      "configuration",
      "tenantId",
    ])
    .optional(),
  sortOrder: sortOrderParam,
})

export const resolveIncidentInput = z.object({
  incidentId: z.string(),
})

export const formatIncidentIssueInput = z.object({
  incidentId: z.string(),
})
