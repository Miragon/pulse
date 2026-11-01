import type { MCPServer } from "mcp-use"
import { createToolRegistrar } from "@miragon/pulse-widget-shell/server"
import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import type { AnalyticsEngineScope } from "../engine-ids.js"
import { registerPerformanceTools } from "./performance.js"
import { registerFailureTools } from "./failures.js"
import { registerElementTools } from "./element.js"
import { registerClusterCompareTools } from "./cluster-compare.js"
import { registerVersionCompareTools } from "./version-compare.js"
import { registerEngineCompareTools } from "./engine-compare.js"
import { registerEngineLandscapeTools } from "./engine-landscape.js"
import { registerHealthTools } from "./health.js"

/**
 * An omitted value takes the client schema's default, as in the widget tools;
 * `engineScope` keeps every query on configured engines (`engine-ids.ts`).
 */
export function registerTools(
  server: MCPServer,
  client: PrometheusClient,
  engineScope: AnalyticsEngineScope,
): void {
  const register = createToolRegistrar(server, client)
  registerPerformanceTools(register, engineScope)
  registerFailureTools(register, engineScope)
  registerElementTools(register, engineScope)
  registerClusterCompareTools(register, engineScope)
  registerVersionCompareTools(register, engineScope)
  registerEngineCompareTools(register, engineScope)
  registerEngineLandscapeTools(register, engineScope)
  registerHealthTools(register, engineScope)
}
