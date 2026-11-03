// Constants so a tool rename trips a TS error at every call site.
// The one engine view: the cockpit routes itself.
export const ENGINE_OPEN_COCKPIT = "engine_open_cockpit"
// Feeds, not widget tools: the host would render a widget tool's result instead of returning it to callTool().
export const ENGINE_COCKPIT_OVERVIEW_DATA = "engine_cockpit_overview_data"
export const ENGINE_PROCESS_INSTANCES_DATA = "engine_process_instances_data"
export const ENGINE_INSTANCE_DETAIL_DATA = "engine_instance_detail_data"
export const ENGINE_JOBS_DATA = "engine_jobs_data"
export const ENGINE_INCIDENTS_DATA = "engine_incidents_data"
// Every section of the definition view reads this one feed under a shared query key.
export const ENGINE_PROCESS_INCIDENTS_DATA = "engine_process_incidents_data"
export const ENGINE_ACTIVITY_INCIDENTS_DATA = "engine_activity_incidents_data"
export const ENGINE_INCIDENT_DETAIL_DATA = "engine_incident_detail_data"
export const ENGINE_HISTORY_TIMELINE_DATA = "engine_history_timeline_data"
// A definition's XML never changes, so the widget keeps it for good and the server caches it.
export const ENGINE_BPMN_XML_DATA = "engine_bpmn_xml_data"
export const ENGINE_HEALTH_DATA = "engine_health_data"
export const ENGINE_CLUSTER_DETAIL_DATA = "engine_cluster_detail_data"
export const ENGINE_LIST_ENGINES = "engine_list_engines"
// The toolset may not register these, so widgets ask `*_widget_actions_data` which exist.
// `src/widget-actions.test.ts` fails on an in-widget write missing here.
export const ENGINE_WIDGET_ACTIONS = [
  "engine_set_job_retries",
  // The failedExternalTask incident's remedy (resolve refuses that type).
  "engine_set_external_task_retries",
  "engine_resolve_incident",
  "engine_complete_task",
  "engine_set_process_instance_variable",
  "engine_set_process_instance_suspension",
  "engine_delete_process_instance",
] as const
export type EngineWidgetAction = (typeof ENGINE_WIDGET_ACTIONS)[number]
export const ENGINE_WIDGET_ACTIONS_DATA = "engine_widget_actions_data"
