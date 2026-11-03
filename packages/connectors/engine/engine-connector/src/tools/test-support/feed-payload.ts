import { decodeToolResult, type ToolResult } from "@miragon/pulse-widget-shell/server"

/** `structuredContent`, else a feed's JSON text, so tests hold whichever channel a tool uses. */
export const feedPayload = <T = Record<string, unknown>>(result: unknown): T =>
  decodeToolResult<T>(result as ToolResult)
