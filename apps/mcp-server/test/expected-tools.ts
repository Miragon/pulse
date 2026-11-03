/**
 * Checked-in snapshots of the tool surface per toolset, sorted by name.
 * `tools-list.golden.test.ts` compares `tools/list` against them, so adding,
 * renaming, removing or re-tiering a tool fails CI until these lists (and the
 * README surface they document) are updated deliberately. Miragon/miragon-ai-docs
 * reads this file from main too (its required check "miragon-ai references",
 * `scripts/check-miragon-ai-refs.mjs` there), so it stays until that check reads
 * the admin golden instead.
 *
 * Layered on purpose: each tier is the one below plus an explicit list, so a
 * review sees exactly what a toolset adds.
 *
 * - READ_ONLY: the unauthenticated default (no suffix, no OAuth provider) =
 *   `engine:read-only` plus analytics (which declares no toolsets). Only
 *   `readOnlyHint` tools.
 * - OPERATIONS: the default under OAuth = `engine:operations,analytics`,
 *   which adds the engine writes.
 * - ADMIN: `engine:admin,analytics` + `ENGINE_ALLOW_DEPLOYMENTS=true`:
 *   the full surface. Never implied by a default.
 *
 * Regenerate by running the golden test and copying the sorted names from the
 * assertion diffs. These lists pin WHICH tools a toolset exposes; the full
 * wire payload of each (descriptions, annotations, visibility, schemas) is
 * pinned per toolset by tools-list.golden.test.ts → `__golden__/tools-*.json`;
 * a tool change updates both (`GOLDEN_UPDATE=1`, see golden.ts).
 */
export const EXPECTED_TOOLS_READ_ONLY: readonly string[] = [
  "analytics_bpmn_heatmap_data",
  "analytics_bpmn_xml_data",
  "analytics_engine_health",
  "analytics_engine_landscape_data",
  "analytics_show_bpmn_heatmap",
  "analytics_show_dashboard",
  "analytics_show_engine_compare",
  "analytics_show_engine_landscape",
  "analytics_show_period_compare",
  "analytics_show_version_compare",
  "engine_activity_incidents_data",
  "engine_bpmn_xml_data",
  "engine_cluster_detail_data",
  "engine_cockpit_overview_data",
  "engine_health_data",
  "engine_status",
  "engine_format_incident_issue",
  "engine_get_deployment",
  "engine_get_job_stacktrace",
  "engine_get_process_definition_xml",
  "engine_get_process_instance_variables",
  "engine_get_task",
  "engine_get_task_form",
  "engine_get_task_variables",
  "engine_history_timeline_data",
  "engine_incident_detail_data",
  "engine_incidents_data",
  "engine_inspect_process_instance",
  "engine_instance_detail_data",
  "engine_jobs_data",
  "engine_list_deployments",
  "engine_list_engines",
  "engine_list_external_tasks",
  "engine_list_incidents",
  "engine_list_jobs",
  "engine_list_process_definitions",
  "engine_list_process_instances",
  "engine_list_tasks",
  "engine_open_cockpit",
  "engine_process_incidents_data",
  "engine_process_instances_data",
  "engine_query_historic_activity_instances",
  "engine_query_historic_incidents",
  "engine_query_historic_process_instances",
  "engine_query_historic_task_instances",
  "engine_query_historic_variable_instances",
  "engine_widget_actions_data",
]

/** What `engine:operations` adds: the engine writes. */
const OPERATIONS_ADDS: readonly string[] = [
  "engine_claim_task",
  "engine_complete_task",
  "engine_correlate_message",
  "engine_resolve_incident",
  "engine_set_external_task_retries",
  "engine_set_job_retries",
  "engine_set_process_instance_variable",
  "engine_set_task_assignee",
  "engine_start_process_instance",
  "engine_unclaim_task",
]

/** What `engine:admin` (+ ENGINE_ALLOW_DEPLOYMENTS=true) adds, never implied. */
const ADMIN_ADDS: readonly string[] = [
  "engine_complete_external_task",
  "engine_create_deployment",
  "engine_create_migration_plan",
  "engine_delete_process_instance",
  "engine_fetch_and_lock",
  "engine_get_activity_instance_tree",
  "engine_get_batch",
  "engine_handle_external_task_failure",
  "engine_migrate_process_instances_async",
  "engine_modify_process_instance",
  "engine_set_job_retries_batch",
  "engine_set_process_instance_suspension",
  "engine_throw_signal",
]

export const EXPECTED_TOOLS_OPERATIONS: readonly string[] = [
  ...EXPECTED_TOOLS_READ_ONLY,
  ...OPERATIONS_ADDS,
].sort()

export const EXPECTED_TOOLS_ADMIN: readonly string[] = [
  ...EXPECTED_TOOLS_OPERATIONS,
  ...ADMIN_ADDS,
].sort()
