import type { AppConfig, AppConfigEntry, AppPlugin } from "@miragon/mcp-toolkit-core"
import type { MCPServer } from "mcp-use"

import {
  camunda7Module,
  configuredEngineIds,
  createBpmnXmlFetcher,
} from "@miragon/pulse-camunda7-connector"
import { analyticsModule } from "@miragon/pulse-analytics-connector"
import {
  composeModules,
  createShellPlugin,
  frameworkWritesAllowed,
  HTTP_EDGE_ENV_VARS,
  OAUTH_ENV_VARS,
  type ProfileStore,
  type ResolveBootOptions,
  type ResolvedBoot,
} from "@miragon/pulse-widget-shell/server"
import type { ModuleDefinition, SharedResources } from "./module-contract.js"
import { createDefaultProfileStore } from "./persistence/index.js"
import { SERVER_LABEL } from "./server-label.js"

/**
 * The bundle definition: which modules THIS app composes. Each module brings
 * its own config schema, env mapping and known env vars (see
 * `module-contract.ts`) — this file only selects (via the shared
 * `composeModules` machinery), warns, and wires.
 */
const MODULES: readonly ModuleDefinition[] = [camunda7Module, analyticsModule]

/**
 * App-owned env vars; each module contributes its own slice via
 * `knownEnvVars`, the shared HTTP edge (`MCP_URL`, the Host/Origin
 * allow-lists, the body cap, the metrics token) via `HTTP_EDGE_ENV_VARS`,
 * the shared OAuth wiring (`MCP_OAUTH`) via `OAUTH_ENV_VARS`.
 * Foreign prefixes owned by dependencies (`MCP_USE_*`, `MCP_INSPECTOR_*`) are
 * exempt inside `composeModules`.
 */
const APP_ENV_VARS = [
  ...HTTP_EDGE_ENV_VARS,
  ...OAUTH_ENV_VARS,
  "MCP_ACTIVE_MODULES",
  "MCP_DASHBOARD_DIR",
  "MCP_PROFILE_DIR",
  // Postgres persistence for profiles + dashboards (src/persistence/). Listed
  // for documentation AND because every known var contributes its prefix to
  // the typo watcher.
  "DATABASE_URL",
  // mcp-use's request-log level, read by mcp-use itself (the boot warns at
  // debug/trace).
  "MCP_USE_LOG_LEVEL",
]

/**
 * The composition `createApp` hands to the shared boot
 * (`createComposedServer`), which resolves the selection ONCE per boot —
 * authenticated exactly when `createApp` installs an OAuth provider.
 */
export const composition = composeModules<SharedResources>({
  label: SERVER_LABEL,
  modules: MODULES,
  appEnvVars: APP_ENV_VARS,
  envVarHint: "see docs/mcp/operations.md",
})

export const warnUnknownEnvVars = composition.warnUnknownEnvVars
export const emitBootWarnings = composition.emitBootWarnings
export const logEffectiveToolsets = composition.logEffectiveToolsets

/**
 * The module selection as the boot resolves it: each module's effective
 * toolset (fail closed — no suffix is the read-only floor unless OAuth is
 * installed) threaded into its config. The default (no OAuth) keeps
 * argument-less callers (tests) on the restrictive side.
 */
export function resolveBoot(
  options: ResolveBootOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedBoot {
  return composition.resolveBoot(env, options)
}

export function getAppConfig(boot: ResolvedBoot = resolveBoot()): AppConfig {
  return { activeApps: boot.entries, pipelines: {} }
}

/**
 * Cross-module wiring — the one thing that stays app-owned by design: which
 * module's capability reaches which other module is configuration knowledge
 * (see `module-contract.ts`). Store *selection* lives in
 * `src/persistence/initRuntime`; this only distributes the chosen instance.
 */
function buildSharedResources(
  entries: AppConfigEntry[],
  profileStore: ProfileStore,
): SharedResources {
  // From the camunda7 module, for modules that must not depend on the engine
  // SDK: the BPMN-XML lookup (on any of its engines — the analytics heatmap
  // and the names in the analytics views) and
  // the configured engine ids (the only engines analytics reads from a
  // possibly shared Prometheus). Absent when camunda7 is inactive: the heatmap
  // degrades, analytics falls back to ANALYTICS_ENGINE_IDS, else fails closed.
  const camunda7Entry = entries.find((e) => e.app === camunda7Module.name)
  if (!camunda7Entry) return { profileStore }
  return {
    profileStore,
    fetchBpmnXml: createBpmnXmlFetcher(camunda7Entry.config),
    engineIds: configuredEngineIds(camunda7Entry.config),
  }
}

/**
 * `createApp` passes the store `initRuntime` selected (possibly Postgres) and
 * the once-per-boot selection; the defaults keep argument-less callers (tests)
 * on the filesystem/in-memory path and the unauthenticated defaults without
 * duplicating either selection here.
 */
export function getPlugins(
  profileStore: ProfileStore = createDefaultProfileStore(),
  boot: ResolvedBoot = resolveBoot(),
): AppPlugin<MCPServer>[] {
  const { entries } = boot
  const shared = buildSharedResources(entries, profileStore)
  return [
    // Always-on shell (`shell:*`): the generic widgets plus the settings page
    // and the UI language, deliberately outside the MCP_ACTIVE_MODULES
    // selection. Its language save is a framework write: OAuth and no module
    // on its read-only floor. Catalogue, tools and components live in
    // @miragon/pulse-widget-shell (apps own no domain UI).
    createShellPlugin({ profileStore, allowSave: frameworkWritesAllowed(boot) }),
    ...composition.pluginsFor(entries, shared),
  ]
}
