import { listIncidentsInput, resolveIncidentInput } from "../schemas/index.js"
import type { EngineToolRegistrar } from "../lib/engine/served-engines.js"
import { engineKeyList, engineSorting, toOptionalEngineDate } from "@miragon/pulse-c7-core"
import { getIncidents, getIncidentsCount, resolveIncident } from "@miragon/pulse-c7-client/sdk"
import { paginatedListOutput, toPaginatedList } from "../lib/mcp/pagination.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"

export function registerIncidentTools(register: EngineToolRegistrar) {
  register({
    name: "engine_list_incidents",
    category: "incidents",
    description: "List incidents (errors) in the engine: failed jobs, external task failures, etc.",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    dialects: ["c7"],
    inputSchema: { ...listIncidentsInput.shape, ...engineParamShape },
    outputSchema: paginatedListOutput,
    handler: withEngine(async (client, args) => {
      const filters = {
        processInstanceId: args.processInstanceId,
        // The engine filters incidents by key only as a comma list.
        processDefinitionKeyIn: engineKeyList(
          args.processDefinitionKey,
          args.processDefinitionKeyIn,
        ),
        processDefinitionId: args.processDefinitionId,
        activityId: args.activityId,
        incidentType: args.incidentType,
        incidentTimestampAfter: toOptionalEngineDate(args.incidentTimestampAfter),
        incidentTimestampBefore: toOptionalEngineDate(args.incidentTimestampBefore),
      }
      const [items, count] = await Promise.all([
        getIncidents({
          client,
          query: {
            ...filters,
            firstResult: args.firstResult,
            maxResults: args.maxResults,
            ...engineSorting(args),
          },
        }),
        getIncidentsCount({ client, query: filters }),
      ])
      return toPaginatedList(items, count, args.firstResult)
    }),
  })

  register({
    name: "engine_resolve_incident",
    category: "incidents",
    description:
      "Resolve a custom incident by ID. The engine refuses failedJob/failedExternalTask (400); retry those instead: " +
      "engine_set_job_retries / engine_set_external_task_retries on the incident's configuration id.",
    annotations: { destructiveHint: false, openWorldHint: true },
    dialects: ["c7"],
    inputSchema: { ...resolveIncidentInput.shape, ...engineParamShape },
    handler: withEngine(async (client, args) => {
      await resolveIncident({ client, path: { id: args.incidentId } })
      return { success: true, incidentId: args.incidentId }
    }),
  })
}
