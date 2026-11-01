/**
 * Checked-in snapshots of the tool surface per toolset, sorted by name. The
 * E2E tests compare `tools/list` against them, so adding, renaming, removing or
 * re-tiering a tool fails CI until these lists (and the README surface they
 * document) are updated deliberately.
 *
 * Layered on purpose — each tier is the one below plus an explicit list, so a
 * review sees exactly what a toolset adds:
 *
 * - READ_ONLY: the unauthenticated default (no suffix, no MCP_OAUTH) =
 *   `camunda7:read-only,analytics:read-only`. Only `readOnlyHint` tools.
 * - OPERATIONS: the default under OAuth = `camunda7:operations,
 *   analytics:standard` — engine writes and the three settings saves (the
 *   shell's language save needs OAuth + no read-only module).
 * - ADMIN: `camunda7:admin,analytics:standard` + `CAMUNDA_ALLOW_DEPLOYMENTS=true`
 *   under OAuth — the full surface. Never implied by a default.
 *
 * Regenerate by running the E2E tests and copying the sorted names from the
 * assertion diffs. These lists pin WHICH tools a toolset exposes; the full
 * wire payload of each (descriptions, annotations, visibility, schemas) is
 * pinned per toolset by tools-list.golden.test.ts → `__golden__/tools-*.json`
 * — a tool change updates both (`GOLDEN_UPDATE=1`, see golden.ts).
 */
export const EXPECTED_TOOLS_READ_ONLY: readonly string[] = [
  "analytics_analyze_process_performance",
  "analytics_bpmn_heatmap_data",
  "analytics_bpmn_xml_data",
  "analytics_cluster_compare",
  "analytics_compare_execution_periods",
  "analytics_element_bottleneck",
  "analytics_engine_compare",
  "analytics_engine_health",
  "analytics_engine_landscape",
  "analytics_engine_landscape_data",
  "analytics_find_failed_instances",
  "analytics_settings_data",
  "analytics_show_bpmn_heatmap",
  "analytics_show_cluster_compare",
  "analytics_show_dashboard",
  "analytics_show_engine_compare",
  "analytics_show_engine_landscape",
  "analytics_show_failure_dashboard",
  "analytics_show_settings",
  "analytics_show_version_compare",
  "analytics_version_compare",
  "camunda7_activity_incidents_data",
  "camunda7_bpmn_xml_data",
  "camunda7_cluster_detail_data",
  "camunda7_cockpit_overview_data",
  "camunda7_engine_health_data",
  "camunda7_format_incident_issue",
  "camunda7_get_activity_instance_tree",
  "camunda7_get_deployment",
  "camunda7_get_job_stacktrace",
  "camunda7_get_process_definition_xml",
  "camunda7_get_process_instance",
  "camunda7_get_process_instance_variables",
  "camunda7_get_task",
  "camunda7_get_task_form",
  "camunda7_get_task_variables",
  "camunda7_incident_detail_data",
  "camunda7_incidents_data",
  "camunda7_instance_detail_data",
  "camunda7_jobs_data",
  "camunda7_list_deployments",
  "camunda7_list_engines",
  "camunda7_list_external_tasks",
  "camunda7_list_incidents",
  "camunda7_list_jobs",
  "camunda7_list_process_definitions",
  "camunda7_list_process_instances",
  "camunda7_list_tasks",
  "camunda7_open_cockpit",
  "camunda7_process_incidents_data",
  "camunda7_process_instances_data",
  "camunda7_process_list_data",
  "camunda7_query_historic_activity_instances",
  "camunda7_query_historic_incidents",
  "camunda7_query_historic_process_instances",
  "camunda7_query_historic_task_instances",
  "camunda7_query_historic_variable_instances",
  "camunda7_settings_data",
  "camunda7_show_bpmn_viewer",
  "camunda7_show_cluster_detail",
  "camunda7_show_engine_health",
  "camunda7_show_history_timeline",
  "camunda7_show_incident_detail",
  "camunda7_show_incidents_dashboard",
  "camunda7_show_instance_detail",
  "camunda7_show_job_panel",
  "camunda7_show_process_detail",
  "camunda7_show_process_incidents",
  "camunda7_show_process_instances",
  "camunda7_show_process_list",
  "camunda7_show_settings",
  "camunda7_widget_actions_data",
  "shell_settings_data",
  "shell_show_settings",
]

/** What `operations` (camunda7) / `standard` (analytics) and the shell's language save add. */
const OPERATIONS_ADDS: readonly string[] = [
  "analytics_save_settings",
  "camunda7_claim_task",
  "camunda7_complete_task",
  "camunda7_correlate_message",
  "camunda7_resolve_incident",
  "camunda7_save_settings",
  "camunda7_select_engine",
  "camunda7_set_external_task_retries",
  "camunda7_set_job_retries",
  "camunda7_set_process_instance_variable",
  "camunda7_set_task_assignee",
  "camunda7_start_process_instance",
  "camunda7_unclaim_task",
  "shell_save_settings",
]

/** What `camunda7:admin` (+ CAMUNDA_ALLOW_DEPLOYMENTS=true) adds — never implied. */
const ADMIN_ADDS: readonly string[] = [
  "camunda7_complete_external_task",
  "camunda7_create_deployment",
  "camunda7_create_migration_plan",
  "camunda7_delete_process_instance",
  "camunda7_fetch_and_lock",
  "camunda7_get_batch",
  "camunda7_handle_external_task_failure",
  "camunda7_migrate_process_instances_async",
  "camunda7_modify_process_instance",
  "camunda7_set_job_retries_batch",
  "camunda7_set_process_instance_suspension",
  "camunda7_throw_signal",
]

export const EXPECTED_TOOLS_OPERATIONS: readonly string[] = [
  ...EXPECTED_TOOLS_READ_ONLY,
  ...OPERATIONS_ADDS,
].sort()

export const EXPECTED_TOOLS_ADMIN: readonly string[] = [
  ...EXPECTED_TOOLS_OPERATIONS,
  ...ADMIN_ADDS,
].sort()
