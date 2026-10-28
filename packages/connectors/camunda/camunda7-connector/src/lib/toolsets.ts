import type { createToolRegistrar, ToolConfig } from "@miragon/mcp-toolkit-core/tools"
import type { z } from "zod"
import { createToolsetVocabulary } from "@miragon/pulse-widget-shell/server"
import type { EngineRegistry } from "./resolve-engine.js"
import {
  CAMUNDA7_SAVE_SETTINGS,
  CAMUNDA7_WIDGET_ACTIONS,
  type Camunda7WidgetAction,
} from "../tool-names.js"

type Register = ReturnType<typeof createToolRegistrar<EngineRegistry>>
type ZodRawShape = Record<string, z.ZodType>

export const CAMUNDA7_TOOLSETS = ["read-only", "operations", "admin"] as const
export type Camunda7Toolset = (typeof CAMUNDA7_TOOLSETS)[number]

/** `read-only` is the floor; an authenticated boot without a suffix gets `operations`. */
export const camunda7Toolsets = createToolsetVocabulary(
  "camunda7",
  CAMUNDA7_TOOLSETS,
  "read-only",
  {
    authenticatedDefault: "operations",
  },
)

/** A missing toolset resolves to the floor too: only a direct `createPlugin` caller omits it. */
export function resolveCamunda7Toolset(toolset?: string): Camunda7Toolset {
  return camunda7Toolsets.resolve(toolset)
}

/**
 * Admin regardless of annotations: irreversible, deploying (code in the engine JVM),
 * engine-wide broadcasts, and the external-task worker protocol (fetch-and-lock withholds
 * tasks from production workers). `camunda7_create_migration_plan` and `camunda7_get_batch`
 * are reads but useless without their admin partners, so they stay together.
 */
const ADMIN_ONLY_TOOLS: ReadonlySet<string> = new Set([
  "camunda7_delete_process_instance",
  "camunda7_modify_process_instance",
  "camunda7_set_process_instance_suspension",
  "camunda7_create_deployment",
  "camunda7_create_migration_plan",
  "camunda7_migrate_process_instances_async",
  "camunda7_set_job_retries_batch",
  "camunda7_get_batch",
  "camunda7_throw_signal",
  "camunda7_fetch_and_lock",
  "camunda7_complete_external_task",
  "camunda7_handle_external_task_failure",
])

/** Public for guard tests in composing servers. */
export const CAMUNDA7_ADMIN_ONLY_TOOLS: readonly string[] = Object.freeze([...ADMIN_ONLY_TOOLS])

/** `read-only` lists only `readOnlyHint` tools, no exemptions: a read that must show there is its own tool. Widget tools and feeds are not filtered. */
export function isToolInToolset(
  config: Pick<ToolConfig<EngineRegistry>, "name" | "annotations">,
  toolset: Camunda7Toolset,
): boolean {
  if (toolset === "admin") return true
  if (ADMIN_ONLY_TOOLS.has(config.name)) return false
  if (toolset === "operations") return true
  return config.annotations?.readOnlyHint === true
}

/** `camunda7_select_engine` writes the same profile field, so this is the one profile-write decision. */
export function allowsProfileSave(toolset: Camunda7Toolset): boolean {
  return isToolInToolset({ name: CAMUNDA7_SAVE_SETTINGS }, toolset)
}

/** Widget buttons render from this, so a button and the tool surface never disagree. */
export function allowedWidgetActions(toolset: Camunda7Toolset): Camunda7WidgetAction[] {
  return CAMUNDA7_WIDGET_ACTIONS.filter((name) => isToolInToolset({ name }, toolset))
}

export function withToolsetFilter(register: Register, toolset: Camunda7Toolset): Register {
  const filtered = <TShape extends ZodRawShape>(config: ToolConfig<EngineRegistry, TShape>) => {
    if (isToolInToolset(config, toolset)) register(config)
  }
  return Object.assign(filtered, { getRegisteredTools: () => register.getRegisteredTools() })
}
