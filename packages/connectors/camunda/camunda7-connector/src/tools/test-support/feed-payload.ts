import { parseToolResult } from "@miragon/mcp-toolkit-ui"

/** `structuredContent`, else a feed's JSON text, so tests hold whichever channel a tool uses. */
export const feedPayload = <T = Record<string, unknown>>(result: unknown): T =>
  parseToolResult<T>(result)
