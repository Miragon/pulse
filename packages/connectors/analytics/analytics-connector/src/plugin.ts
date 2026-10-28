import type { AppPlugin } from "@miragon/mcp-toolkit-core"
import type { MCPServer } from "mcp-use"
import { installMcpRequestContext } from "@miragon/pulse-widget-shell/server"
import { createPrometheusClient, type PrometheusConfig } from "@miragon/pulse-analytics-client"
import { registerTools } from "./tools/index.js"
import { registerSettingsTools } from "./settings-tools.js"
import { registerWidgetTools } from "./widget-tools.js"
import { createNameLookup, type FetchBpmnXml } from "./bpmn-name-lookup.js"
import { definition } from "./definition.js"
import type { ProfileSource } from "./server-locale.js"
import { analyticsToolsets } from "./toolsets.js"
import { createEngineScope } from "./engine-ids.js"
import type { AnalyticsAppConfig } from "./steps/app-config.js"

export interface AnalyticsPluginConfig extends PrometheusConfig {
  /** Injected by the host so this module stays free of engine SDKs; absent → ids, no diagram. */
  fetchBpmnXml?: FetchBpmnXml
  /** Shared with camunda7; this module owns `modules.analytics`. */
  profileStore?: ProfileSource
  /** Typed `string` so a configured value passes through; resolved fail-closed here. */
  toolset?: string
  /** Empty or absent: every engine-reading tool refuses (`engine-ids.ts`). */
  engineIds?: readonly string[]
}

export function createPlugin(config: AnalyticsPluginConfig): AppPlugin<MCPServer> {
  const client = createPrometheusClient({
    url: config.url,
    bearerToken: config.bearerToken,
    username: config.username,
    password: config.password,
    headers: config.headers,
    timeoutMs: config.timeoutMs,
  })
  const engineScope = createEngineScope(config.engineIds)
  // ONE name lookup (and its per-caller cache) for the tools, the feeds and the steps.
  const namesFor = createNameLookup(config.fetchBpmnXml)
  // The steps get the profile store too: a step's omitted period resolves to
  // the caller's saved default, like every tool's.
  const appConfig = {
    client,
    engineScope,
    profileStore: config.profileStore,
    namesFor,
  } satisfies AnalyticsAppConfig
  return {
    definition,
    appConfig,
    // Pipeline steps get no handler ctx, so they read the ambient request info
    // (idempotent; the host installs it too).
    registerTools: (server) => {
      installMcpRequestContext(server)
      registerTools(server, client, engineScope, config.profileStore)
    },
    registerWidgetTools: (server) => {
      registerWidgetTools(server, client, {
        fetchBpmnXml: config.fetchBpmnXml,
        namesFor,
        profileStore: config.profileStore,
        engineScope,
      })
      registerSettingsTools(server, config.profileStore, analyticsToolsets.resolve(config.toolset))
    },
  }
}
