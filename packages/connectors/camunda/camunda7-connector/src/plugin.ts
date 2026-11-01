import {
  createInMemoryProfileStore,
  createToolRegistrar,
  type ModulePlugin,
  type ProfileStore,
} from "@miragon/pulse-widget-shell/server"
import type { Camunda7AuthType } from "@miragon/pulse-camunda7-client"
import { providerForEntry } from "./providers/index.js"
import { registerTools } from "./tools/index.js"
import { registerIncidentIssuePrompt, registerIncidentIssueTools } from "./tools/incident-issue.js"
import { registerEngineTools } from "./tools/engines.js"
import { registerUserProfileTools } from "./tools/user-profile.js"
import { registerWidgetTools } from "./widget-tools.js"
import {
  createEngineRegistry,
  type EngineEntry,
  type EngineRegistry,
} from "./lib/resolve-engine.js"
import { profileDefaultEngineId } from "./lib/engine-preferences.js"
import {
  allowsProfileSave,
  resolveCamunda7Toolset,
  withToolsetFilter,
  type Camunda7Toolset,
} from "./lib/toolsets.js"
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

/** The routing every tool resolves its engine through: per-engine auth, then the caller's saved default. */
export function createCamunda7EngineRegistry(
  config: Camunda7PluginConfig,
  profileStore: ProfileStore,
  toolset: Camunda7Toolset,
): EngineRegistry {
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
    {
      // Same store the settings tools write, so select_engine and the settings page route alike.
      defaultEngineId: (call) => profileDefaultEngineId(profileStore, config.engines, call),
      // Only when the save is registered AND the caller has an identity to save under.
      canSaveDefault: (call) => allowsProfileSave(toolset) && resolveProfileKey(call) !== undefined,
    },
  )
}

export function createPlugin(
  config: Camunda7PluginConfig,
  shared: Camunda7SharedResources = {},
): ModulePlugin {
  const profileStore = shared.profileStore ?? createInMemoryProfileStore()
  // Resolved once so every gate below reads the same toolset and an unknown name warns once.
  const toolset = resolveCamunda7Toolset(config.toolset)
  const registry = createCamunda7EngineRegistry(config, profileStore, toolset)

  const incidentIssueConfig = {
    repository: config.incidentIssueRepository,
    // No cockpit URL here: issue links use the resolved engine's.
  }
  // The widgets filter every tool their hand-offs name by it (#338).
  const surface = createModelSurface()

  return {
    name: "camunda7",
    register(server) {
      const recorded = surface.record(server)
      const register = withEngineParam(
        withToolsetFilter(createToolRegistrar(recorded, registry), toolset),
        config.engines,
      )
      registerEngineTools(register, profileStore)
      // Deployments are opt-in on top of `admin` (code execution in the JVM).
      registerTools(register, { allowDeployments: config.allowDeployments })
      registerIncidentIssueTools(register, incidentIssueConfig)
      registerIncidentIssuePrompt(server, incidentIssueConfig)
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
