// Constants so a tool rename trips a TS error at every call site.
// The one camunda7 view: the cockpit routes itself.
export const CAMUNDA7_OPEN_COCKPIT = "camunda7_open_cockpit"
// Feeds, not widget tools: the host would render a widget tool's result instead of returning it to callTool().
export const CAMUNDA7_COCKPIT_OVERVIEW_DATA = "camunda7_cockpit_overview_data"
export const CAMUNDA7_PROCESS_INSTANCES_DATA = "camunda7_process_instances_data"
export const CAMUNDA7_INSTANCE_DETAIL_DATA = "camunda7_instance_detail_data"
export const CAMUNDA7_JOBS_DATA = "camunda7_jobs_data"
export const CAMUNDA7_INCIDENTS_DATA = "camunda7_incidents_data"
// Every section of the definition view reads this one feed under a shared query key.
export const CAMUNDA7_PROCESS_INCIDENTS_DATA = "camunda7_process_incidents_data"
export const CAMUNDA7_ACTIVITY_INCIDENTS_DATA = "camunda7_activity_incidents_data"
export const CAMUNDA7_INCIDENT_DETAIL_DATA = "camunda7_incident_detail_data"
export const CAMUNDA7_HISTORY_TIMELINE_DATA = "camunda7_history_timeline_data"
// A definition's XML never changes, so the widget keeps it for good and the server caches it.
export const CAMUNDA7_BPMN_XML_DATA = "camunda7_bpmn_xml_data"
export const CAMUNDA7_ENGINE_HEALTH_DATA = "camunda7_engine_health_data"
export const CAMUNDA7_CLUSTER_DETAIL_DATA = "camunda7_cluster_detail_data"
export const CAMUNDA7_LIST_ENGINES = "camunda7_list_engines"
// The toolset may not register these, so widgets ask `*_widget_actions_data` which exist.
// `src/widget-actions.test.ts` fails on an in-widget write missing here.
export const CAMUNDA7_WIDGET_ACTIONS = [
  "camunda7_set_job_retries",
  // The failedExternalTask incident's remedy — resolve refuses that type.
  "camunda7_set_external_task_retries",
  "camunda7_resolve_incident",
  "camunda7_complete_task",
  "camunda7_set_process_instance_variable",
  "camunda7_set_process_instance_suspension",
  "camunda7_delete_process_instance",
] as const
export type Camunda7WidgetAction = (typeof CAMUNDA7_WIDGET_ACTIONS)[number]
export const CAMUNDA7_WIDGET_ACTIONS_DATA = "camunda7_widget_actions_data"
