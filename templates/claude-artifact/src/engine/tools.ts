/**
 * Every tool the page calls, by its exact name on the Pulse MCP server: model tools of the
 * read-only floor only, never a `*_data` feed (app-only, for the server's own views) and never a
 * view tool. Publishing the artifact declares exactly these in its `mcp` capability, so a call to a
 * tool missing here fails as `not_allowed`. Add a tool here before a section calls it.
 */
export const PAGE_TOOLS = [
  "engine_list_engines",
  "engine_status",
  "engine_list_process_definitions",
  "engine_get_process_definition_xml",
  "engine_list_process_instances",
  "engine_list_incidents",
  "engine_list_tasks",
  "engine_query_historic_process_instances",
  "engine_query_historic_activity_instances",
] as const

export type ToolName = (typeof PAGE_TOOLS)[number]

export function isPageTool(name: string): name is ToolName {
  return (PAGE_TOOLS as readonly string[]).includes(name)
}
