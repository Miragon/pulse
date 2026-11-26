/**
 * The values a copy of the template sets: the process, the connector and the tools the page calls.
 * Plain TypeScript without imports, so the page, the tests and the scripts (`pnpm record`,
 * `pnpm shot`, which Node runs with its type stripping) read the same values, and publishing
 * declares the page's `mcp` capability from this one file.
 */

/**
 * The process the dashboard shows. A dashboard of another process changes this key, records its
 * fixtures (`pnpm record`) and edits the sections.
 */
export const PROCESS_KEY = "miraveloLeasing"

/**
 * The display name of the viewer's connector to the Pulse MCP server, the name the viewers gave it
 * in claude.ai: the page calls its tools by this name, and publishing declares the page's `mcp`
 * capability for it.
 */
export const CONNECTOR_NAME = "Pulse"

/**
 * Every tool the page calls, by its exact name on the Pulse MCP server: model tools of the
 * read-only floor only, never a `*_data` feed (app-only, for the server's own views) and never a
 * view tool. Publishing the artifact declares exactly these in its `mcp` capability,
 * `{ "mcp": { "servers": [{ "server": CONNECTOR_NAME, "tools": PAGE_TOOLS }] } }`, so a call to a
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

/** A tool the page calls: its reads name only these (`PageReader<ToolName>`). */
export type ToolName = (typeof PAGE_TOOLS)[number]
