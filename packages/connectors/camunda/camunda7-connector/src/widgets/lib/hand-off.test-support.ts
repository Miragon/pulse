import { vi } from "vitest"
import { feedPayload } from "../../tools/test-support/feed-payload.js"
import type { MCPServer } from "mcp-use"
import type { ToolSurface } from "@miragon/pulse-widget-shell/widgets"
import { createPlugin } from "../../plugin.js"
import type { Camunda7Toolset } from "../../lib/toolsets.js"
import { CAMUNDA7_WIDGET_ACTIONS_DATA } from "../../tool-names.js"
import { bindHandOff, camunda7Surface } from "./hand-off.js"

/** Runs the real registration paths, so tests can't drift from the toolsets like a hand-written list. */
export async function liveSurface(
  toolset: Camunda7Toolset,
  { analyticsActive = false }: { analyticsActive?: boolean } = {},
): Promise<ToolSurface & { tools: string[] }> {
  const tools = (await widgetActionsFeedFor(toolset)).modelTools
  return { ...camunda7Surface(tools, analyticsActive), tools }
}

export async function widgetActionsFeedFor(
  toolset: Camunda7Toolset,
): Promise<{ allowedActions: string[]; modelTools: string[] }> {
  const tool = vi.fn()
  const server = { tool, use: vi.fn(), prompt: vi.fn() } as unknown as MCPServer
  const plugin = createPlugin({
    engines: [{ id: "prod-a", baseUrl: "http://a.example/engine-rest" }],
    toolset,
  })
  plugin.registerTools?.(server)
  plugin.registerWidgetTools?.(server)
  const calls = tool.mock.calls as Array<[{ name: string }, (p: unknown) => Promise<unknown>]>
  const feed = calls.find(([definition]) => definition.name === CAMUNDA7_WIDGET_ACTIONS_DATA)
  return feedPayload<{ allowedActions: string[]; modelTools: string[] }>(await feed![1]({}))
}

export async function handOffFor(
  toolset: Camunda7Toolset,
  options: { locale?: string; analyticsActive?: boolean } = {},
) {
  return bindHandOff(options.locale ?? "en", await liveSurface(toolset, options))
}
