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
  "apps/mcp-server/test/__golden__/tools-admin.json",
)

const METRICS_CONTRACT = path.join(
  import.meta.dirname,
  "..",
  "packages/connectors/analytics/analytics-client/metrics-contract.json",
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

/**
 * The metric names and labels of the metrics contract: every `promName`, a histogram's
 * `_bucket`/`_sum`/`_count` series and every label. They share the engine module's tool prefix
 * (`engine_jobs_failed`, `engine_id`), so a scanner that reads `<module>_…` as a tool name skips
 * exactly these, and every OTHER `engine_…` token still has to be a tool.
 * @returns {Set<string>}
 */
export function metricVocabulary() {
  /** @type {{ metrics: { promName: string, type: string, labels: string[] }[] }} */
  const contract = JSON.parse(readFileSync(METRICS_CONTRACT, "utf8"))
  return new Set(
    contract.metrics.flatMap(({ promName, type, labels }) => [
      promName,
      ...(type === "histogram" ? ["_bucket", "_sum", "_count"].map((s) => promName + s) : []),
      ...labels,
    ]),
  )
}
