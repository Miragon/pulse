import type { MCPServer } from "mcp-use"
import { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import type { ProfileSource } from "../server-locale.js"
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
 * Same "explicit arg > saved setting > schema default" resolution as the widget
 * tools; `engineScope` keeps every query on configured engines (`engine-ids.ts`).
 */
export function registerTools(
  server: MCPServer,
  client: PrometheusClient,
  engineScope: AnalyticsEngineScope,
  profileStore?: ProfileSource,
): void {
  // An unknown key is a tool error, never a silently dropped filter (#329).
  const register = createToolRegistrar(server, client, { strictInput: true })
  registerPerformanceTools(register, engineScope, profileStore)
  registerFailureTools(register, engineScope)
  registerElementTools(register, engineScope, profileStore)
  registerClusterCompareTools(register, engineScope, profileStore)
  registerVersionCompareTools(register, engineScope, profileStore)
  registerEngineCompareTools(register, engineScope, profileStore)
  registerEngineLandscapeTools(register, engineScope)
  registerHealthTools(register, engineScope)
}
