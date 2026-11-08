import { recordingModuleServer } from "@miragon/pulse-widget-shell/testing"
import { feedPayload } from "../../tools/test-support/feed-payload.js"
import { createPlugin } from "../../plugin.js"
import type { EngineToolset } from "../../lib/mcp/toolsets.js"
import { ENGINE_WIDGET_ACTIONS_DATA } from "../../tool-names.js"

/** Runs the real registration paths, so tests can't drift from the toolsets like a hand-written list. */
export async function widgetActionsFeedFor(
  toolset: EngineToolset,
): Promise<{ allowedActions: string[] }> {
  const recording = recordingModuleServer()
  const plugin = createPlugin({
    engines: [{ id: "prod-a", baseUrl: "http://a.example/engine-rest" }],
    toolset,
  })
  plugin.register(recording.server)
  const result = await recording.tool(ENGINE_WIDGET_ACTIONS_DATA).call({})
  return feedPayload<{ allowedActions: string[] }>(result)
}
