/**
 * Every tool the page calls, by its exact name on the Pulse MCP server: model tools of the
 * read-only floor only, never a `*_data` feed (app-only, for the server's own views) and never a
 * view tool. Publishing the artifact declares exactly these in its `mcp` capability, so a call to a
 * tool missing here fails as `not_allowed`. Add a tool here before a section calls it.
 *
 * One load calls each once: a process's numbers now and per day (`engine_process_stats`), its
 * counts per activity with the diagram's decorations (`engine_activity_counts`) and the XML of the
 * diagram those counts name (`engine_get_process_definition_xml`).
 */
export const PAGE_TOOLS = [
  "engine_process_stats",
  "engine_activity_counts",
  "engine_get_process_definition_xml",
] as const

export type ToolName = (typeof PAGE_TOOLS)[number]

export function isPageTool(name: string): name is ToolName {
  return (PAGE_TOOLS as readonly string[]).includes(name)
}
