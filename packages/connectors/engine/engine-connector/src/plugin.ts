import { createToolRegistrar, type ModulePlugin } from "@miragon/pulse-widget-shell/server"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { providerForEntry } from "./providers/index.js"
import { registerTools } from "./tools/index.js"
import { registerIncidentIssuePrompt, registerIncidentIssueTools } from "./tools/incident-issue.js"
import { registerEngineTools } from "./tools/engines.js"
import { registerWidgetTools } from "./widget-tools.js"
import type { EngineEntry } from "./engine-provider.js"
import {
  createEngineRegistry,
  type EngineRegistry,
  type RefusedProfile,
} from "./lib/engine/resolve-engine.js"
import { resolveEngineToolset, withToolsetFilter } from "./lib/mcp/toolsets.js"
import { withEngineParam } from "./lib/engine/with-engine.js"
import { withReadOnlyEngines } from "./lib/engine/read-only.js"

export interface EnginePluginConfig {
  /**
   * The usable profiles, each with its own auth (none without one), deadline and `readOnly`.
   * `passthrough` forwards each caller's MCP bearer token to the engine. Only for a trusted
   * single-audience setup: the engine could replay it here (the boot warns).
   */
  engines: EngineEntry[]
  /** The refused profiles: engine_list_engines lists them, a call to one fails. */
  refused?: RefusedProfile[]
  /** Every profile name, refused ones included, in the order of the file: the `engine` enum. */
  engineIds?: string[]
  /** Every profile, refused and nameless ones included: only one alone is the default. */
  profileCount?: number
  /** `ENGINE_DEFAULT` or `defaultProfile`: where a call without `engine` routes. */
  defaultEngine?: string
  /** Omitted or unknown means `read-only`, never everything. */
  toolset?: string
  /** Deploying is code execution in the engine JVM: needs this flag AND the `admin` toolset. */
  allowDeployments?: boolean
  /** For an engine whose profile sets no `timeout`; unset: 30 s, to the answer's last byte. */
  requestTimeoutMs?: number
  /** Operator-fixed so no tool argument can redirect drafts; enables the prefilled issue URL. */
  incidentIssueRepository?: string
  /** A small installation may turn critical at 10 incidents where a large one tolerates hundreds. */
  healthThresholds?: {
    criticalIncidents?: number
    criticalClusterSize?: number
  }
}

/** The routing every tool resolves its engine through: each engine on its own profile. */
export function createConfiguredEngineRegistry(config: EnginePluginConfig): EngineRegistry {
  return createEngineRegistry(
    config.engines,
    (e) =>
      // Each profile's own auth, never another's: one without auth sends no credentials.
      providerForEntry(e).createClient(e, e.auth ?? { type: "none" }, {
        timeoutMs: e.timeoutMs ?? config.requestTimeoutMs,
        readOnly: e.readOnly === true,
      }),
    {
      defaultEngineId: config.defaultEngine,
      refused: config.refused,
      engineIds: config.engineIds,
      profileCount: config.profileCount,
    },
  )
}

export function createPlugin(config: EnginePluginConfig): ModulePlugin {
  const registry = createConfiguredEngineRegistry(config)
  // Resolved once so every gate below reads the same toolset and an unknown name warns once.
  const toolset = resolveEngineToolset(config.toolset)
  // The deployment's ENGINE_HEALTH_* over c7-core's defaults, one set for the cockpit's
  // overview and engine_status, so both judge alike.
  const healthThresholds = { ...DEFAULT_VERDICT_THRESHOLDS, ...config.healthThresholds }

  const incidentIssueConfig = {
    repository: config.incidentIssueRepository,
    // No cockpit URL here: issue links use the resolved engine's.
  }
  return {
    name: "engine",
    register(server) {
      // A write that its toolset registers still fails on an engine whose profile is readOnly.
      const register = withEngineParam(
        withReadOnlyEngines(withToolsetFilter(createToolRegistrar(server, registry), toolset)),
        registry.engineIds,
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
