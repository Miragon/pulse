import type { PageErrorCode } from "@miragon/pulse-ui"
import type { ToolName } from "./tools.ts"

/**
 * The page's one door to the engine: a tool call on the Pulse MCP server. The artifact's runtime
 * answers it through the viewer's connector (`claude-connector.ts`), the fixtures through the mock
 * (`fixtures/mock-claude.ts`), the recorder through an MCP client (`scripts/record.ts`).
 */
export interface Connector {
  callTool(
    name: ToolName,
    args: Record<string, unknown>,
    options?: CallOptions,
  ): Promise<ToolResult>
}

export interface CallOptions {
  /**
   * The viewer asked for fresh numbers (Refresh, or Try again after a failure): a cache under the
   * connector must not answer, the server has to. The artifact's runtime keeps answers of its own.
   */
  refresh?: boolean
}

/** What a tool call answers, as MCP's `CallToolResult` has it: the parts the page reads. */
export interface ToolResult {
  isError?: boolean
  content?: { type: string; text?: string }[]
  structuredContent?: unknown
}

/**
 * Why a call gave no data, as pulse-ui's page error vocabulary has it (`PageErrorCode`), so the
 * kit words each code (`describePageError`):
 * - `needs_reauth`: the connector's sign-in ran out, the viewer has to reconnect it
 * - `not_connected`: the viewer has no connector of the name the page calls, or has to pick one
 * - `not_allowed`: the page may not call this tool (its `mcp` capability does not name it, or a
 *   policy of the viewer's organization blocks it)
 * - `approval_required`: the viewer has not approved the page's access yet
 * - `unavailable`: the connector or the server does not answer
 * - `tool_error`: the call failed otherwise, mostly the server's error (the engine's or the
 *   tool's own), its text classified by widget-shell's `describeError`
 */
export type EngineErrorCode = PageErrorCode

/** A failed call: its code, the tool it called and the raw text behind it (shown under Details). */
export class EngineError extends Error {
  readonly code: EngineErrorCode
  readonly tool: ToolName | undefined
  /** The raw text of the failure: the server's error text, or the runtime's message. */
  readonly detail: string

  constructor(code: EngineErrorCode, tool: ToolName | undefined, detail: string) {
    super(`${code}${tool === undefined ? "" : ` (${tool})`}: ${detail}`)
    this.name = "EngineError"
    this.code = code
    this.tool = tool
    this.detail = detail
  }
}

/** Whatever was thrown, as an `EngineError`: one of ours as it is, anything else as `unavailable`. */
export function asEngineError(error: unknown, tool?: ToolName): EngineError {
  if (error instanceof EngineError) return error
  const detail = error instanceof Error ? error.message : String(error)
  return new EngineError("unavailable", tool, detail)
}
