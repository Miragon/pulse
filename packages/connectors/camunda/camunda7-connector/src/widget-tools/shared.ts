import type { z } from "zod"
import type { MCPServer } from "mcp-use"
import type { EngineHealthThresholds } from "../data/health-data.js"
import { clusterDetailFilterShape, pagingShape } from "../feed-contracts.js"
import type { EngineCallContext, EngineRegistry, resolveEngine } from "../lib/resolve-engine.js"
import type { Camunda7Toolset } from "../lib/toolsets.js"
import type { EngineParamShape } from "../lib/with-engine.js"
import {
  type buildSingleWidgetView,
  showToolBinding,
  strictToolInput,
  withToolErrors,
  type ProfileStore,
} from "@miragon/pulse-widget-shell/server"

/** Incident messages can be stacktrace-sized. */
export function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** Mirrors the cockpit's "process-detail" route (`widgets/cockpit-app/views.ts`); the entry only sets the focus. */
export function definitionViewLayout(focus?: "incidents") {
  return [
    { row: [{ widget: "camunda7:process-detail-header" }] },
    { row: [{ widget: "camunda7:process-definition-kpi" }] },
    { row: [{ widget: "camunda7:process-definition-flow" }] },
    {
      row: [
        {
          widget: "camunda7:activity-incident-list",
          props: { emptyVariant: focus === "incidents" ? "siblings" : "note" },
        },
      ],
    },
  ]
}

export type ResolvedEngine = Awaited<ReturnType<typeof resolveEngine>>

export const clusterDetailShape = { ...clusterDetailFilterShape, ...pagingShape }

export interface WidgetToolsContext {
  server: MCPServer
  registry: EngineRegistry
  healthThresholds: EngineHealthThresholds
  profileStore: ProfileStore
  toolset: Camunda7Toolset
  modelTools: () => string[]
  engineParam: EngineParamShape
}

type ShowArgs<TShape extends z.ZodRawShape> = z.output<z.ZodObject<TShape & EngineParamShape>>

interface ShowTool<TShape extends z.ZodRawShape> {
  name: string
  title: string
  description: string
  shape: TShape
  render: (
    args: ShowArgs<TShape>,
    ctx: EngineCallContext,
  ) => Promise<ReturnType<typeof buildSingleWidgetView>>
}

export function registerShowTool<TShape extends z.ZodRawShape>(
  { server, engineParam }: WidgetToolsContext,
  tool: ShowTool<TShape>,
) {
  server.tool(
    {
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
      inputSchema: strictToolInput({ ...tool.shape, ...engineParam }),
      ...showToolBinding(tool.name, tool.title),
    },
    withToolErrors((args, ctx) => tool.render(args as ShowArgs<TShape>, ctx)),
  )
}
