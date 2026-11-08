import type { ModuleServer } from "@miragon/pulse-widget-shell/server"
import { createToolRegistrar } from "@miragon/pulse-widget-shell/server"
import type { PrometheusClient } from "@miragon/pulse-analytics-client"
import type { AnalyticsEngineScope } from "../engine-ids.js"
import { registerHealthTools } from "./health.js"

/**
 * The one text-only read; every other analytics question has its show tool (`widget-tools.ts`).
 * `engineScope` keeps every query on configured engines (`engine-ids.ts`).
 */
export function registerTools(
  server: ModuleServer,
  client: PrometheusClient,
  engineScope: AnalyticsEngineScope,
): void {
  const register = createToolRegistrar(server, client)
  registerHealthTools(register, engineScope)
}
