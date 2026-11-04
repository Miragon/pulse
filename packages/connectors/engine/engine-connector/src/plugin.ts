import { createToolRegistrar, type ModulePlugin } from "@miragon/pulse-widget-shell/server"
import type { EngineAuthType } from "@miragon/pulse-engine-client"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-engine-core"
import { providerForEntry } from "./providers/index.js"
import { registerTools } from "./tools/index.js"
import { registerIncidentIssuePrompt, registerIncidentIssueTools } from "./tools/incident-issue.js"
import { registerEngineTools } from "./tools/engines.js"
import { registerWidgetTools } from "./widget-tools.js"
import type { EngineEntry } from "./engine-provider.js"
import { createEngineRegistry, type EngineRegistry } from "./lib/engine/resolve-engine.js"
import { resolveEngineToolset, withToolsetFilter } from "./lib/mcp/toolsets.js"
import { withEngineParam } from "./lib/engine/with-engine.js"

export interface EnginePluginConfig {
  engines: EngineEntry[]
  /**
   * `passthrough` forwards each caller's MCP bearer token to the engine. Only for a
   * trusted single-audience setup: the engine could replay it here (the boot warns).
   */
  authType?: EngineAuthType
  username?: string
  password?: string
  token?: string
  /** `ENGINE_DEFAULT`: where a call without `engine` routes when several are configured. */
  defaultEngine?: string
  /** Omitted or unknown means `read-only`, never everything. */
  toolset?: string
  /** Deploying is code execution in the engine JVM: needs this flag AND the `admin` toolset. */
  allowDeployments?: boolean
  /** Unset: the client default (30 s). */
  requestTimeoutMs?: number
  /** Operator-fixed so no tool argument can redirect drafts; enables the prefilled issue URL. */
  incidentIssueRepository?: string
  /** A small installation may turn critical at 10 incidents where a large one tolerates hundreds. */
  healthThresholds?: {
    criticalIncidents?: number
    criticalClusterSize?: number
  }
}

/** The routing every tool resolves its engine through: per-engine auth, then the default engine. */
export function createConfiguredEngineRegistry(config: EnginePluginConfig): EngineRegistry {
  return createEngineRegistry(
    config.engines,
    (e) => {
      // Wholesale: a partial entry must not inherit foreign credentials.
      const auth = e.auth ?? {
        type: config.authType ?? "none",
        username: config.username,
        password: config.password,
        token: config.token,
      }
      return providerForEntry(e).createClient(e, auth, { timeoutMs: config.requestTimeoutMs })
    },
    { defaultEngineId: config.defaultEngine },
  )
}

/** `registry`: the module's one registry for this config, shared with its BPMN lookup (module.ts). */
export function createPlugin(
  config: EnginePluginConfig,
  registry: EngineRegistry = createConfiguredEngineRegistry(config),
): ModulePlugin {
  // Resolved once so every gate below reads the same toolset and an unknown name warns once.
  const toolset = resolveEngineToolset(config.toolset)
  // The deployment's ENGINE_HEALTH_* over engine-core's defaults, one set for the cockpit's
  // overview and engine_status, so both judge alike.
  const healthThresholds = { ...DEFAULT_VERDICT_THRESHOLDS, ...config.healthThresholds }

  const incidentIssueConfig = {
    repository: config.incidentIssueRepository,
    // No cockpit URL here: issue links use the resolved engine's.
  }
  return {
    name: "engine",
    register(server) {
      const register = withEngineParam(
        withToolsetFilter(createToolRegistrar(server, registry), toolset),
        config.engines,
      )
      registerEngineTools(register, healthThresholds)
      // Deployments are opt-in on top of `admin` (code execution in the JVM).
      registerTools(register, { allowDeployments: config.allowDeployments })
      registerIncidentIssueTools(register, incidentIssueConfig)
      registerIncidentIssuePrompt(server, incidentIssueConfig)
      registerWidgetTools(server, registry, { healthThresholds, toolset })
    },
  }
}
