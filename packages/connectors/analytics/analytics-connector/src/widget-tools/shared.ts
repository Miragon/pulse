import type { MCPServer } from "mcp-use"
import { buildViewResult } from "@miragon/pulse-widget-shell/server"
import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import type { AnalyticsEngineScope } from "../engine-ids.js"
import type { NameLookup } from "../bpmn-name-lookup.js"

/**
 * The `_meta`/view bindings are not passed: each registration spreads `showToolBinding()`/`appOnly`
 * itself, keeping the dual-protocol contract in one place.
 */
export interface AnalyticsWidgetToolsContext {
  server: MCPServer
  ch: PrometheusClient
  /** The server's configured engine ids: every query resolves `engine` through it. */
  engineScope: AnalyticsEngineScope
  /** The process names behind the ids a view lists (`bpmn-name-lookup.ts`); absent → ids. */
  namesFor?: NameLookup
}

/**
 * The view renders `view`; the model reads the query result as compact JSON, every figure the
 * view shows and nothing it only names (`names` stays in the view).
 */
export const viewWithJson = (view: object, result: object) =>
  buildViewResult(view, JSON.stringify(result))
