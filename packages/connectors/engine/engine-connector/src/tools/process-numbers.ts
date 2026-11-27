import { activityCountsInput, processStatsInput } from "../schemas/index.js"
import type { EngineToolRegistrar } from "../lib/engine/served-engines.js"
import { engineParamShape, withEngine } from "../lib/engine/with-engine.js"
import { buildActivityCountsData } from "../data/activity-counts-data.js"
import { buildProcessStatsData } from "../data/process-stats-floor.js"

/**
 * A key's numbers ready to show, for a page that draws them (a dashboard, a Claude artifact) as
 * much as for the model, each read once instead of paged and summed by the caller. Both are reads
 * of the read-only floor. Their `processDefinitionKey` is a filter, as on every tool (the
 * instructions' one rule): it spans every version of the key in every tenant, which on an engine
 * without tenants is the process the cockpit shows, and so are the reads the cockpit's process
 * view reads there; one tenant's process is the cockpit's process view and `engine_get_screen`'s
 * (`tenantId`), so neither tool takes a tenant, nor names the cockpit (F17b, 2026-11-27).
 */
export function registerProcessNumberTools(register: EngineToolRegistrar) {
  register({
    name: "engine_process_stats",
    category: "process-numbers",
    description:
      "A process's numbers, every version of its key: now (running, open root incidents, " +
      "instances with an incident, jobs without retries, open tasks, started and ended in 24 h), " +
      "and per day or hour bucket started, ended and ended per end event, with median and P90 " +
      "duration in ms overall and per end event. A count is { atLeast } where history may be " +
      "removed (history.keptFrom), null unknown (history.recorded false: no history written).",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    dialects: ["c7"],
    inputSchema: { ...processStatsInput.shape, ...engineParamShape },
    handler: withEngine((client, args, { engineId }) =>
      buildProcessStatsData(client, engineId, args),
    ),
  })

  register({
    name: "engine_activity_counts",
    category: "process-numbers",
    description:
      "Per activity, over every version in every tenant: running tokens, open user tasks " +
      "(and the oldest), open root incidents, incidents of called instances, jobs without " +
      "retries, each kind's latest incident; plus the diagram's decorations. definitionId names " +
      "the diagram counted on (XML: engine_get_process_definition_xml).",
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    dialects: ["c7"],
    inputSchema: { ...activityCountsInput.shape, ...engineParamShape },
    handler: withEngine((client, args, { engineId }) =>
      buildActivityCountsData(client, engineId, args),
    ),
  })
}
