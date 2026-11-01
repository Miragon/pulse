import type { MCPServer } from "mcp-use"
import type { ModulePlugin } from "@miragon/pulse-widget-shell/server"
import { createPrometheusClient, type PrometheusConfig } from "@miragon/pulse-analytics-client"
import { registerTools } from "./tools/index.js"
import { registerWidgetTools } from "./widget-tools.js"
import { createNameLookup, type FetchBpmnXml } from "./bpmn-name-lookup.js"
import { createEngineScope } from "./engine-ids.js"

export interface AnalyticsPluginConfig extends PrometheusConfig {
  /** Injected by the host so this module stays free of engine SDKs; absent → ids, no diagram. */
  fetchBpmnXml?: FetchBpmnXml
  /** Empty or absent: every engine-reading tool refuses (`engine-ids.ts`). */
  engineIds?: readonly string[]
}

export function createPlugin(config: AnalyticsPluginConfig): ModulePlugin {
  const client = createPrometheusClient({
    url: config.url,
    bearerToken: config.bearerToken,
    username: config.username,
    password: config.password,
    headers: config.headers,
    timeoutMs: config.timeoutMs,
  })
  const engineScope = createEngineScope(config.engineIds)
  return {
    name: "analytics",
    register(server: MCPServer) {
      registerTools(server, client, engineScope)
      registerWidgetTools(server, client, {
        fetchBpmnXml: config.fetchBpmnXml,
        namesFor: createNameLookup(config.fetchBpmnXml),
        engineScope,
      })
    },
  }
}
