/**
 * The full tool surface (every module, the admin toolset, deployments on) as the MCP server app's
 * admin golden pins it: the tools/list payload `tools-list.golden.test.ts` holds to the booted
 * server. The source guards read it here instead of booting a server.
 */
import { readFileSync } from "node:fs"
import path from "node:path"

const ADMIN_GOLDEN = path.join(
  import.meta.dirname,
  "..",
  "apps/mcp-server-camunda7/test/__golden__/tools-admin.json",
)

/**
 * @typedef {object} SurfaceTool
 * @property {string} name
 * @property {{ properties?: Record<string, unknown> }} inputSchema
 * @property {{ ui?: { visibility?: string[] } }} [_meta]
 */

/** @returns {SurfaceTool[]} every tool of the full surface */
export function fullSurface() {
  return JSON.parse(readFileSync(ADMIN_GOLDEN, "utf8")).map(({ name, inputSchema, _meta }) => ({
    name,
    inputSchema,
    _meta,
  }))
}

/**
 * A model sees a tool unless its `ui.visibility` leaves the model out (an app-only feed).
 * @param {SurfaceTool} tool
 */
function isModelVisible(tool) {
  const visibility = tool._meta?.ui?.visibility
  return !Array.isArray(visibility) || visibility.includes("model")
}

/** @returns {Set<string>} the app-only feeds: tools only a widget calls */
export function appOnlyFeeds() {
  return new Set(
    fullSurface()
      .filter((tool) => !isModelVisible(tool))
      .map((tool) => tool.name),
  )
}
