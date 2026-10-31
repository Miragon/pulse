import type {
  ComposableModule,
  ProfileSource,
  ProfileStore,
} from "@miragon/pulse-widget-shell/server"
import type { FetchBpmnXml } from "@miragon/pulse-analytics-connector"

/**
 * Compile-time proof that the concrete profile store this app wires still
 * satisfies the narrow port foreign modules consume
 * (`@miragon/pulse-widget-shell/server`). Modules take the store structurally and
 * never import each other, so nothing else would catch a `ProfileStore` change
 * that breaks e.g. the analytics settings section — it would surface as a
 * runtime failure in a module the change never touched. Both types live in
 * widget-shell since the store extraction; the assertion keeps guarding the
 * seam regardless of where either side moves next.
 */
type Assert<T extends true> = T
export type ProfileStoreSatisfiesModulePort = Assert<
  ProfileStore extends ProfileSource ? true : false
>

/**
 * Cross-module resources this app wires at boot and threads into every
 * module's plugin. Owned by the app on purpose: which module's capability
 * reaches which other module (e.g. camunda7's BPMN-XML lookup feeding the
 * analytics heatmap) is configuration knowledge — modules stay peers and
 * never import each other.
 */
export interface SharedResources {
  /**
   * One per-user preference store for the whole server, so engine
   * availability, locale and analytics defaults come from one source.
   * Postgres with `DATABASE_URL`, filesystem-backed when `MCP_PROFILE_DIR` is
   * set (survives restarts), else in-memory.
   */
  profileStore: ProfileStore
  /**
   * Engine-agnostic BPMN-XML lookup (on any of the camunda7 module's
   * engines, its first one by default) consumed by the analytics heatmap and
   * the process and activity names in the analytics views. Absent when the
   * camunda7 module is inactive — consumers degrade gracefully.
   */
  fetchBpmnXml?: FetchBpmnXml
  /**
   * The engine ids this server is configured for (the camunda7 module's
   * engines) — the only engines analytics reads, from a Prometheus that may be
   * shared with other teams. Absent when camunda7 is inactive: analytics then
   * takes `ANALYTICS_ENGINE_IDS`, else refuses every engine read.
   */
  engineIds?: readonly string[]
}

/**
 * The port every mounted module satisfies (structurally — modules do not
 * import this file). The port SHAPE (`ComposableModule`) and the selection
 * machinery live in `@miragon/pulse-widget-shell/server`; what stays app-owned
 * is this instantiation with THIS app's `SharedResources` plus the module
 * list and cross-module wiring in `setup.ts`. A module brings its whole
 * config surface itself: schema validation inside `createPlugin`, env
 * mapping, its slice of the env-typo warner, and optional boot-time hints.
 */
export type ModuleDefinition = ComposableModule<SharedResources>
