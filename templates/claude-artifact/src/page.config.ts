/**
 * The two values a copy of the template sets. Plain TypeScript without imports, so the page, the
 * tests and the scripts (`pnpm record`, `pnpm shot`, which Node runs with its type stripping) read
 * the same values.
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
