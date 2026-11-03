import {
  createToolsetVocabulary,
  type ToolConfig,
  type ToolRegistrar,
} from "@miragon/pulse-widget-shell/server"
import type { EngineRegistry } from "../engine/resolve-engine.js"
import { ENGINE_WIDGET_ACTIONS, type EngineWidgetAction } from "../../tool-names.js"

export const ENGINE_TOOLSETS = ["read-only", "operations", "admin"] as const
export type EngineToolset = (typeof ENGINE_TOOLSETS)[number]

/** `read-only` is the floor; an authenticated boot without a suffix gets `operations`. */
export const engineToolsets = createToolsetVocabulary("engine", ENGINE_TOOLSETS, "read-only", {
  authenticatedDefault: "operations",
})

/** A missing toolset resolves to the floor too: only a direct `createPlugin` caller omits it. */
export function resolveEngineToolset(toolset?: string): EngineToolset {
  return engineToolsets.resolve(toolset)
}

/**
 * Admin regardless of annotations: irreversible, deploying (code in the engine JVM),
 * engine-wide broadcasts, and the external-task worker protocol (fetch-and-lock withholds
 * tasks from production workers). `engine_create_migration_plan`, `engine_get_batch` and
 * `engine_get_activity_instance_tree` (the activity and transition instance ids
 * `engine_modify_process_instance` takes) are reads but useless without their admin
 * partners, so they stay together; below admin, `engine_inspect_process_instance` shows
 * where an instance waits.
 */
const ADMIN_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "engine_delete_process_instance",
  "engine_modify_process_instance",
  "engine_get_activity_instance_tree",
  "engine_set_process_instance_suspension",
  "engine_create_deployment",
  "engine_create_migration_plan",
  "engine_migrate_process_instances_async",
  "engine_set_job_retries_batch",
  "engine_get_batch",
  "engine_throw_signal",
  "engine_fetch_and_lock",
  "engine_complete_external_task",
  "engine_handle_external_task_failure",
])

/** Public for guard tests in composing servers. */
export const ENGINE_ADMIN_ONLY_TOOLS: readonly string[] = Object.freeze([...ADMIN_ONLY_TOOLS])

/** `read-only` lists only `readOnlyHint` tools, no exemptions: a read that must show there is its own tool. Widget tools and feeds are not filtered. */
export function isToolInToolset(
  config: Pick<ToolConfig<EngineRegistry>, "name" | "annotations">,
  toolset: EngineToolset,
): boolean {
  if (toolset === "admin") return true
  if (ADMIN_ONLY_TOOLS.has(config.name)) return false
  if (toolset === "operations") return true
  return config.annotations?.readOnlyHint === true
}

/** Widget buttons render from this, so a button and the tool surface never disagree. */
export function allowedWidgetActions(toolset: EngineToolset): EngineWidgetAction[] {
  return ENGINE_WIDGET_ACTIONS.filter((name) => isToolInToolset({ name }, toolset))
}

export function withToolsetFilter(
  register: ToolRegistrar<EngineRegistry>,
  toolset: EngineToolset,
): ToolRegistrar<EngineRegistry> {
  return (config) => {
    if (isToolInToolset(config, toolset)) register(config)
  }
}
