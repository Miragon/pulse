import { enginesByEnvironment } from "../../lib/environments.js"
import type { ViewContext } from "../lib/hand-off.js"
import { selectedEntity, type CockpitView } from "../nav-core.js"

/** The view was navigated client-side: no chat turn tells the model. */
export function cockpitContext(engineId: string, current: CockpitView): ViewContext {
  const selected = selectedEntity(current)
  return {
    summary:
      "The operator is in the consolidated camunda7 cockpit; navigation is client-side " +
      "(definitions → instances → instance). Offer analysis, a modification or migration plan, " +
      "or a ticket draft when relevant.",
    ids: {
      engine: engineId,
      incidentId: selected.incidentId,
      processInstanceId: selected.processInstanceId,
      processDefinitionKey: selected.processDefinitionKey,
    },
    facts: { view: current.section },
    tools: [
      "camunda7_show_incident_detail",
      "camunda7_show_instance_detail",
      "camunda7_show_process_detail",
      "camunda7_format_incident_issue",
    ],
  }
}

/** No engine is open: the engine ids are facts, not an `engine` to pin. */
export function landingContext(
  engineGroups: Array<{ id: string; engines: Array<{ id: string }> }>,
): ViewContext {
  return {
    summary:
      "The operator is on the camunda7 cockpit's engine picker: no engine is open yet, so nothing " +
      "on screen is scoped to one engine. Before an engine-specific answer, ask which engine they " +
      "mean, or pass `engine` explicitly.",
    facts: {
      engines: engineGroups.flatMap((g) => g.engines.map((e) => e.id)),
      environments: enginesByEnvironment(engineGroups),
    },
    tools: ["camunda7_list_engines", "camunda7_show_engine_health"],
  }
}

/** Never a ranking: engines run different processes. */
export function fleetContext(
  engineGroups: Array<{ id: string; engines: Array<{ id: string }> }>,
): ViewContext {
  return {
    summary:
      "The operator is in the camunda7 cockpit's CROSS-ENGINE mode — an overview across engines, " +
      "not a ranking between them (they run different processes). Drilling into an engine opens " +
      "its single-engine cockpit.",
    ids: { engine: engineGroups.flatMap((g) => g.engines.map((e) => e.id)) },
    facts: { environments: enginesByEnvironment(engineGroups) },
    tools: [
      "analytics_engine_landscape",
      "analytics_engine_health",
      "analytics_engine_compare",
      "analytics_show_failure_dashboard",
      "camunda7_show_engine_health",
    ],
  }
}

export function drillContext(current: CockpitView, engineId: string | undefined): ViewContext {
  const selected = selectedEntity(current)
  return {
    summary:
      "The operator drilled here client-side from this turn's widget (no chat turn); the origin " +
      "view is still reachable via the breadcrumb.",
    ids: {
      engine: engineId,
      incidentId: selected.incidentId,
      processInstanceId: selected.processInstanceId,
      processDefinitionKey: selected.processDefinitionKey,
    },
    facts: { view: current.section },
    tools: [
      "camunda7_show_incident_detail",
      "camunda7_show_instance_detail",
      "camunda7_show_process_detail",
    ],
  }
}
