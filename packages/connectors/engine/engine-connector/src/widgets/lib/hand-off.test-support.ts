import { vi } from "vitest"
import { feedPayload } from "../../tools/test-support/feed-payload.js"
import type { MCPServer } from "mcp-use"
import { createPlugin } from "../../plugin.js"
import type { EngineToolset } from "../../lib/mcp/toolsets.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../../tool-names.js"

/** Runs the real registration paths, so tests can't drift from the toolsets like a hand-written list. */
export async function widgetActionsFeedFor(
  toolset: EngineToolset,
): Promise<{ allowedActions: string[] }> {
  const tool = vi.fn()
  const server = { tool, prompt: vi.fn() } as unknown as MCPServer
  const plugin = createPlugin({
    engines: [{ id: "prod-a", baseUrl: "http://a.example/engine-rest" }],
    toolset,
  })
  plugin.register(server)
  const calls = tool.mock.calls as Array<[{ name: string }, (p: unknown) => Promise<unknown>]>
  const feed = calls.find(([definition]) => definition.name === ENGINE_WIDGET_ACTIONS_DATA)
  return feedPayload<{ allowedActions: string[] }>(await feed![1]({}))
}
