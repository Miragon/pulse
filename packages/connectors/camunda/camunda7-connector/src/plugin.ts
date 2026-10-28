import type { AppPlugin } from "@miragon/mcp-toolkit-core"
import { createToolRegistrar } from "@miragon/mcp-toolkit-core/tools"
import type { MCPServer } from "mcp-use"
import { installMcpRequestContext } from "@miragon/pulse-widget-shell/server"
import type { Camunda7AuthType } from "@miragon/pulse-camunda7-client"
import { providerForEntry } from "./providers/index.js"
import { registerTools } from "./tools/index.js"
import { registerIncidentIssuePrompt, registerIncidentIssueTools } from "./tools/incident-issue.js"
import { registerEngineTools } from "./tools/engines.js"
import { registerUserProfileTools } from "./tools/user-profile.js"
import { registerWidgetTools } from "./widget-tools.js"
import { definition } from "./definition.js"
import { createEngineRegistry, type EngineEntry } from "./lib/resolve-engine.js"
import { profileDefaultEngineId } from "./lib/engine-preferences.js"
import { createInMemoryProfileStore, type ProfileStore } from "@miragon/pulse-widget-shell/server"
import { allowsProfileSave, resolveCamunda7Toolset, withToolsetFilter } from "./lib/toolsets.js"
import { resolveProfileKey } from "./lib/resolve-profile-key.js"
import { createModelSurface } from "./widget-tools/model-surface.js"
import { withEngineParam } from "./lib/with-engine.js"

export interface Camunda7PluginConfig {
  engines: EngineEntry[]
  /**
   * `passthrough` forwards each caller's MCP bearer token to the engine. Only for a
   * trusted single-audience setup: the engine could replay it here (the boot warns).
   */
  authType?: Camunda7AuthType
  username?: string
  password?: string
  token?: string
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

/** Optional so the plugin runs standalone (tests, embedding) on an in-memory store. */
export interface Camunda7SharedResources {
  profileStore?: ProfileStore
}

export function createPlugin(
  config: Camunda7PluginConfig,
  shared: Camunda7SharedResources = {},
): AppPlugin<MCPServer> {
  const profileStore = shared.profileStore ?? createInMemoryProfileStore()
  // Resolved once so every gate below reads the same toolset and an unknown name warns once.
  const toolset = resolveCamunda7Toolset(config.toolset)
  const registry = createEngineRegistry(
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
    {
      // Same store the settings tools write, so select_engine and the settings page route alike.
      defaultEngineId: (call) => profileDefaultEngineId(profileStore, config.engines, call),
      // Only when the save is registered AND the caller has an identity to save under.
      canSaveDefault: (call) => allowsProfileSave(toolset) && resolveProfileKey(call) !== undefined,
    },
  )

  const incidentIssueConfig = {
    repository: config.incidentIssueRepository,
    // No cockpit URL here: issue links use the resolved engine's.
  }
  // The widgets filter every tool their hand-offs name by it (#338).
  const surface = createModelSurface()

  return {
    definition,
    appConfig: {
      registry,
      engines: config.engines,
    },
    registerTools: (server) => {
      // First: passthrough auth and the pipeline steps read it. Idempotent; the host installs it too.
      installMcpRequestContext(server)
      // Strict input: a stripped misnamed filter would widen the result to the whole engine (#329).
      const register = withEngineParam(
        withToolsetFilter(
          createToolRegistrar(surface.record(server), registry, { strictInput: true }),
          toolset,
        ),
        config.engines,
      )
      registerEngineTools(register, profileStore)
      // Deployments are opt-in on top of `admin` (code execution in the JVM).
      registerTools(register, { allowDeployments: config.allowDeployments })
      registerIncidentIssueTools(register, incidentIssueConfig)
      registerIncidentIssuePrompt(server, incidentIssueConfig)
    },
    registerWidgetTools: (server) => {
      const recorded = surface.record(server)
      registerWidgetTools(recorded, registry, {
        healthThresholds: config.healthThresholds,
        profileStore,
        toolset,
        modelTools: surface.tools,
      })
      // The toolset keeps the durable save tool out of `read-only`.
      registerUserProfileTools(recorded, profileStore, registry, toolset)
    },
  }
}
