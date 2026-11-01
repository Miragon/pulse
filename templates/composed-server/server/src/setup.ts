import {
  camunda7Module,
  configuredEngineIds,
  createBpmnXmlFetcher,
} from "@miragon/pulse-camunda7-connector"
import { analyticsModule, type FetchBpmnXml } from "@miragon/pulse-analytics-connector"
import { notesModule } from "@acme/mcp-notes"
import {
  composeModules,
  HTTP_EDGE_ENV_VARS,
  OAUTH_ENV_VARS,
  type ComposableModule,
  type ModuleEntry,
  type ModulePlugin,
  type ResolvedBoot,
} from "@miragon/pulse-widget-shell/server"

/**
 * Cross-module resources the server wires at boot and threads into every
 * module's plugin. App-owned on purpose: which module's capability reaches
 * which other module is configuration knowledge — modules stay peers and
 * never import each other.
 */
export interface SharedResources {
  /**
   * BPMN-XML lookup from the camunda7 module (on any of its engines),
   * consumed by the analytics heatmap and the names in the analytics views.
   * Absent when camunda7 is inactive — consumers degrade gracefully.
   */
  fetchBpmnXml?: FetchBpmnXml
  /**
   * The engine ids this server is configured for (camunda7's engines) — the
   * only engines analytics reads from a Prometheus that may be shared with
   * other teams. Absent when camunda7 is inactive: analytics then takes
   * `ANALYTICS_ENGINE_IDS`, else refuses every engine read.
   */
  engineIds?: readonly string[]
}

/**
 * The port every mounted module satisfies — structurally: modules never
 * import this file, and your own module doesn't have to either. The port
 * shape and selection machinery live in `@miragon/pulse-widget-shell/server`;
 * this app only instantiates it with its own `SharedResources`.
 */
export type ModuleDefinition = ComposableModule<SharedResources>

/**
 * Which modules THIS server composes. Each module brings its own config
 * schema, env mapping and known env vars — this file only selects and wires.
 *
 * Adding a module touches two places next to its `workspace:*` dependency
 * (the `create-module` skill walks through them): this list and the spread
 * in `src/ui/view-registry.ts`. Tailwind picks up workspace modules via the
 * `modules/` glob in `src/ui/globals.css`, and `test/view-registry.test.ts`
 * holds the views to the view-bound tools this list registers.
 *
 * Exported for `test/strict-input.e2e.test.ts`, which boots every toolset
 * each listed module declares — yours included, without a test edit.
 */
export const MODULES: readonly ModuleDefinition[] = [camunda7Module, analyticsModule, notesModule]

/**
 * App-owned env vars; each module contributes its own slice via
 * `knownEnvVars`, the shared HTTP edge (`MCP_URL`, the Host/Origin
 * allow-lists, the body cap, the metrics token) via `HTTP_EDGE_ENV_VARS`, the
 * shared OAuth wiring (`MCP_OAUTH`, read by `oauthFromEnv` in `app.ts`) via
 * `OAUTH_ENV_VARS`. Every known var feeds the boot-time typo warner.
 */
const APP_ENV_VARS = [
  ...HTTP_EDGE_ENV_VARS,
  ...OAUTH_ENV_VARS,
  "MCP_ACTIVE_MODULES",
  // mcp-use's request-log level, read by mcp-use itself (the boot warns at
  // debug/trace).
  "MCP_USE_LOG_LEVEL",
]

/** The composition `createApp` hands to the shared boot (`createComposedServer`). */
export const composition = composeModules<SharedResources>({
  label: "acme-mcp",
  modules: MODULES,
  appEnvVars: APP_ENV_VARS,
})

/** Exported for the `.env.example` guard in `test/env-example.test.ts`. */
export const KNOWN_ENV_VARS = composition.knownEnvVars

/**
 * The module selection as the shared boot resolves it: each module's
 * effective toolset threaded into its config. `createApp`'s boot is
 * authenticated exactly when `oauthFromEnv` built a provider from
 * `MCP_OAUTH`; this argument-less default (tests, `getPlugins()`) is the
 * unauthenticated one: every module without an explicit suffix on its
 * read-only floor.
 */
export function resolveBoot(env: NodeJS.ProcessEnv = process.env): ResolvedBoot {
  return composition.resolveBoot(env)
}

// ── Plugins ──────────────────────────────────────────────────────────────

/**
 * Cross-module wiring — deliberately app-owned: which module's capability
 * reaches which other module is configuration knowledge.
 */
function buildSharedResources(entries: ModuleEntry[]): SharedResources {
  // From camunda7, for modules without an engine-SDK dependency: the BPMN-XML
  // lookup (the analytics heatmap) and the configured engine ids (the only
  // engines analytics reads). Absent when camunda7 is inactive — the heatmap
  // degrades, analytics falls back to ANALYTICS_ENGINE_IDS, else fails closed.
  const camunda7Entry = entries.find((e) => e.app === camunda7Module.name)
  if (!camunda7Entry) return {}
  return {
    fetchBpmnXml: createBpmnXmlFetcher(camunda7Entry.config),
    engineIds: configuredEngineIds(camunda7Entry.config),
  }
}

/**
 * `createApp` passes the once-per-boot selection; the default keeps
 * argument-less callers (tests) working without duplicating it here.
 */
export function getPlugins(boot: ResolvedBoot = resolveBoot()): ModulePlugin[] {
  const { entries } = boot
  return composition.pluginsFor(entries, buildSharedResources(entries))
}
