import { buildIncidentsDashboardData } from "../data/incidents-dashboard-data.js"
import { buildProcessIncidentsData } from "../data/process-incidents-data.js"
import { adapterStep, requiredKey, stringKey } from "./shared.js"

/**
 * Its scoping key has its own name, so a view that also drills into one
 * definition (`camunda7:processDefinitionKey`) does not narrow the overview.
 */
export const loadIncidentsDashboardStep = adapterStep({
  name: "load-incidents-dashboard",
  description:
    "Open incidents across process definitions: exact totals, one card per definition key (all versions) with an activity breakdown. Powers camunda7:incident-overview-kpi and camunda7:incident-process-list.",
  dataType: "camunda7:incidentsDashboard",
  optionalKeys: [
    {
      key: "camunda7:incidentsProcessDefinitionKey",
      description: "Restrict the overview to this definition key.",
    },
    {
      key: "camunda7:incidentType",
      description: 'Restrict the overview to one incident type, e.g. "failedJob".',
    },
  ],
  read: async (context, { client, engineId, ...urls }) => ({
    ...(await buildIncidentsDashboardData(client, {
      ...urls,
      processDefinitionKey: stringKey(context, "camunda7:incidentsProcessDefinitionKey"),
      incidentType: stringKey(context, "camunda7:incidentType"),
    })),
    engineId,
  }),
  produces: { "camunda7:incidentsDashboardData": (data) => data },
})

export const loadProcessIncidentsStep = adapterStep({
  name: "load-process-incidents",
  description:
    "One process definition key across all its versions: running instances, incidents, failed jobs, per-activity incident groups, the latest diagram. Powers the definition-view widgets (process-detail-header, process-definition-kpi, process-definition-flow, activity-incident-list).",
  dataType: "camunda7:processIncidents",
  requires: ["camunda7:processDefinitionKey"],
  read: async (context, { client, engineId, ...urls }) => ({
    ...(await buildProcessIncidentsData(client, {
      ...urls,
      processDefinitionKey: requiredKey(context, "camunda7:processDefinitionKey"),
    })),
    engineId,
  }),
  produces: { "camunda7:processIncidentsData": (data) => data },
})
