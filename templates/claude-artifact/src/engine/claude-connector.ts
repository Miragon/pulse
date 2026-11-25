import { CONNECTOR_NAME } from "../page.config.ts"
import {
  EngineError,
  type CallOptions,
  type Connector,
  type EngineErrorCode,
  type ToolResult,
} from "./connector.ts"
import { ANSWER_TTL_MS } from "./engine.ts"
import type { ToolName } from "./tools.ts"

/**
 * The only file that knows the artifact runtime: the page's `Connector` over the `mcp` capability
 * of a Claude artifact, which calls a tool on the viewer's own connector to the Pulse MCP server.
 *
 * VERIFIED on 2026-11-25 by a probe artifact in claude.ai (runtime contract 0.2.99) against a
 * Pulse MCP server:
 * 1. `window.claude.use("mcp")` resolves to a frozen namespace (`callTool`, `listTools`,
 *    `describeTool`, `server`, `invalidate`, `watchTool`).
 * 2. `callTool(server, tool, args, { cache })` takes positional arguments: `server` is the name
 *    the runtime knows the connector by (`CONNECTOR_NAME`, src/page.config.ts), the name the
 *    `mcp` declaration gives it; `{ cache: { refresh: true } }` asks past the runtime's cache.
 * 3. It resolves to the tool's `CallToolResult` plus `payload`, the tool's JSON
 *    (`structuredContent`).
 * 4. Everything else rejects with a plain object `{ code, message, server }`, never an `Error`:
 *    a runtime refusal with its code (`RUNTIME_CODES` below; `not_in_manifest` for a tool the
 *    declaration leaves out, without a round trip), and a tool's own error answer, strict input
 *    included, as `code: "tool_error"` with the tool's text as `message` and the result under
 *    `result`. A call never resolves with `isError`.
 *
 * STILL UNKNOWN: what `staleTime` and `gcTime` mean exactly (read here as ms, as TanStack Query
 * reads them); a call without them came back from the server, not from a cache.
 *
 * Publishing declares the capability as `{ "mcp": { "servers": [{ "server": CONNECTOR_NAME,
 * "tools": PAGE_TOOLS }] } }` (`src/engine/tools.ts`); a call to another tool is refused.
 */

/** How long the runtime holds an answer no read uses any more (its cache's `gcTime`), 10 min. */
const KEEP_MS = 600_000

export interface CacheOptions {
  staleTime: number
  gcTime: number
  refresh?: boolean
}

/** What a call resolves to: the tool's result with `payload`, its JSON. */
export type McpAnswer = ToolResult & { payload?: unknown }

export interface McpCapability {
  callTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    options?: { cache?: CacheOptions },
  ): Promise<McpAnswer>
}

/** The slice of the artifact runtime the page uses. */
export interface ClaudeRuntime {
  use?(capability: "mcp"): Promise<McpCapability | null | undefined>
}

declare global {
  interface Window {
    claude?: ClaudeRuntime
  }
}

/** The runtime's refusal codes, each as the page's code; any other is the page's `tool_error`. */
export const RUNTIME_CODES: ReadonlyMap<string, EngineErrorCode> = new Map([
  ["needs_reauth", "needs_reauth"],
  ["server_not_connected", "not_connected"],
  ["selection_required", "not_connected"],
  ["not_in_manifest", "not_allowed"],
  ["blocked_by_policy", "not_allowed"],
  ["approval_required", "approval_required"],
  ["server_unavailable", "unavailable"],
])

/** The cache option of a call: the engine's own keep time, none for a fresh answer. */
export function cacheOptions({ refresh = false }: CallOptions = {}): CacheOptions {
  return refresh
    ? { staleTime: 0, gcTime: KEEP_MS, refresh: true }
    : { staleTime: ANSWER_TTL_MS, gcTime: KEEP_MS }
}

/**
 * A rejection as the page's `EngineError`: a runtime code as the page's, its code shown before
 * its message under Details; any other code, or none, as `otherwise` with its message alone, so
 * the kit classifies an engine's text.
 */
export function runtimeError(
  error: unknown,
  tool: ToolName,
  otherwise: EngineErrorCode = "tool_error",
): EngineError {
  if (error instanceof EngineError) return error
  const fields = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown
    message?: unknown
  }
  // An object without a message has none, never its `[object Object]`.
  const message =
    typeof fields.message === "string"
      ? fields.message
      : typeof error === "object" && error !== null
        ? ""
        : String(error)
  const raw = typeof fields.code === "string" ? fields.code : undefined
  const code = raw === undefined ? undefined : RUNTIME_CODES.get(raw)
  return raw === undefined || code === undefined
    ? new EngineError(otherwise, tool, message || (raw ?? ""))
    : new EngineError(code, tool, message ? `[${raw}] ${message}` : `[${raw}]`)
}

/**
 * An answer as the engine reads it (`resultData`): `payload` as the data, a text payload (a tool
 * that answers text only) as its text. A tool's error never resolves: it rejects as `tool_error`.
 */
export function resultOf(answer: McpAnswer): ToolResult {
  const { payload } = answer
  return typeof payload === "string"
    ? { content: [{ type: "text", text: payload }] }
    : { structuredContent: payload }
}

/**
 * The page's connector over `runtime` (default: the artifact's `window.claude`, read at the first
 * call). A refusal forgets the capability, so the next try asks the runtime anew and a connector
 * connected meanwhile answers it.
 */
export function claudeConnector(
  runtime?: ClaudeRuntime,
  server: string = CONNECTOR_NAME,
): Connector {
  let capability: Promise<McpCapability> | undefined

  async function capabilityOf(tool: ToolName): Promise<McpCapability> {
    const claude = runtime ?? globalThis.window?.claude
    if (typeof claude?.use !== "function") {
      throw new EngineError(
        "not_connected",
        tool,
        "window.claude.use is missing: the page runs outside a Claude artifact.",
      )
    }
    let mcp: McpCapability | null | undefined
    try {
      mcp = await claude.use("mcp")
    } catch (error) {
      throw runtimeError(error, tool, "not_connected")
    }
    if (mcp === null || mcp === undefined) {
      throw new EngineError(
        "not_connected",
        tool,
        'window.claude.use("mcp") gave no capability: the page declares no mcp capability.',
      )
    }
    return mcp
  }

  return {
    async callTool(name, args, options) {
      try {
        capability ??= capabilityOf(name)
        const mcp = await capability
        return resultOf(await mcp.callTool(server, name, args, { cache: cacheOptions(options) }))
      } catch (error) {
        const refused = runtimeError(error, name)
        if (refused.code !== "tool_error") capability = undefined
        throw refused
      }
    },
  }
}
