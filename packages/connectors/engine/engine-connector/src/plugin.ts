import {
  createToolRegistrar,
  type ModulePlugin,
  type ToolRegistrar,
} from "@miragon/pulse-widget-shell/server"
import { DEFAULT_VERDICT_THRESHOLDS } from "@miragon/pulse-c7-core"
import { providerForEntry } from "./providers/index.js"
import { registerTools } from "./tools/index.js"
import {
  ENGINE_FORMAT_INCIDENT_ISSUE,
  registerIncidentIssuePrompt,
  registerIncidentIssueTools,
} from "./tools/incident-issue.js"
import { registerEngineTools } from "./tools/engines.js"
import { registerWidgetTools } from "./widget-tools.js"
import type { BoardFiles } from "./board-files.js"
import type { EngineEntry } from "./engine-provider.js"
import {
  createEngineRegistry,
  type EngineRegistry,
  type RefusedProfile,
} from "./lib/engine/resolve-engine.js"
import { resolveEngineToolset, withToolsetFilter } from "./lib/mcp/toolsets.js"
import { withServedEngines } from "./lib/engine/served-engines.js"
import { contractRuntimeOf } from "./lib/engine/engine-runtime.js"

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
  /** The boards of ENGINE_BOARDS_DIR, read at configuration: the board feed builds them. */
  boards?: BoardFiles
}

/** The ids of the configured boards that name `engineId`, in the order of the board files. */
function boardsNaming(boards: BoardFiles | undefined, engineId: string): string[] {
  return (boards?.boards ?? [])
    .filter(({ board }) => board.engines.includes(engineId))
    .map(({ id }) => id)
}

/**
 * The routing every tool resolves its engine through: each engine on its own profile, one of the
 * Camunda 7 REST dialect with its client, one of Camunda 8 with its runtime over a connection of
 * its own (each built once, here) and the boards that name it.
 */
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
      contractRuntime: (e) => contractRuntimeOf(e, { timeoutMs: config.requestTimeoutMs }),
      boardsNaming: (engineId) => boardsNaming(config.boards, engineId),
    },
  )
}

/** The engine module over `registry`, by default the one `config` configures. */
export function createPlugin(
  config: EnginePluginConfig,
  registry: EngineRegistry = createConfiguredEngineRegistry(config),
): ModulePlugin {
  // Resolved once so every gate below reads the same toolset and an unknown name warns once.
  const toolset = resolveEngineToolset(config.toolset)
  // The deployment's ENGINE_HEALTH_* over c7-core's defaults, one set for the cockpit's
  // overview, engine_status and the web app's verdict, so all judge alike. Per key: the
  // configuration names both keys when one variable is set, the other undefined, which a spread
  // would take over the default and so switch that threshold off.
  const healthThresholds = {
    criticalIncidents:
      config.healthThresholds?.criticalIncidents ?? DEFAULT_VERDICT_THRESHOLDS.criticalIncidents,
    criticalClusterSize:
      config.healthThresholds?.criticalClusterSize ??
      DEFAULT_VERDICT_THRESHOLDS.criticalClusterSize,
  }

  const incidentIssueConfig = {
    repository: config.incidentIssueRepository,
    // No cockpit URL here: issue links use the resolved engine's.
  }
  return {
    name: "engine",
    register(server) {
      // Every tool the registrar registers, so a widget's write button names only those.
      const registered = new Set<string>()
      const registrar = createToolRegistrar(server, registry)
      const recorded: ToolRegistrar<EngineRegistry> = (tool) => {
        registered.add(tool.name)
        registrar(tool)
      }
      // A tool registers where its toolset holds it and a configured engine serves it (a write
      // only where one is writable), its `engine` enum offers those, and a call to another fails
      // before its handler runs.
      const register = withServedEngines(withToolsetFilter(recorded, toolset), registry)
      registerEngineTools(register, healthThresholds, config.boards)
      // Deployments are opt-in on top of `admin` (code execution in the JVM).
      registerTools(register, { allowDeployments: config.allowDeployments })
      registerIncidentIssueTools(register, incidentIssueConfig)
      // The prompt drafts through engine_format_incident_issue: where that tool is, it is.
      if (registered.has(ENGINE_FORMAT_INCIDENT_ISSUE)) {
        registerIncidentIssuePrompt(server, incidentIssueConfig)
      }
      registerWidgetTools(server, registry, {
        healthThresholds,
        toolset,
        registered,
        ...(config.boards ? { boards: config.boards } : {}),
      })
    },
  }
}
