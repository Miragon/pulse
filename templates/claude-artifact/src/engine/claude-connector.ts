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
 * VERIFIED against the built page of a working artifact that reads an MCP connector this way:
 * 1. `window.claude.use("mcp")` returns a promise of the capability, which is null or undefined
 *    when the page has none.
 * 2. `callTool(server, tool, args, { cache })` takes positional arguments: `server` is the display
 *    name the viewer gave the connector (`CONNECTOR_NAME` below), `cache` is
 *    `{ staleTime, gcTime }` and `{ staleTime: 0, gcTime, refresh: true }` for a fresh answer.
 * 3. It resolves to `{ payload }`, the tool's JSON answer (a list tool's `{ items, totalCount,
 *    hasMore, nextOffset }`).
 * 4. A call the runtime refuses rejects with `code` (one of `RUNTIME_CODES` below) and `message`.
 *
 * STILL UNKNOWN, so the code below stays tolerant: whether a tool's error answer (`isError`)
 * rejects or resolves (a resolved answer with `isError`, and a rejection with any other code or
 * none, is the page's `tool_error`, its text classified by the kit as the server's error), and
 * what `staleTime` and `gcTime` mean exactly (read here as ms, as TanStack Query reads them).
 *
 * Publishing declares the page's `mcp` capability for the connector named `CONNECTOR_NAME` with
 * exactly the tools of `PAGE_TOOLS` (`src/engine/tools.ts`); a call to another tool is refused.
 */

/**
 * The display name of the viewer's connector to the Pulse MCP server: the name the viewer gave it
 * in claude.ai, so whoever publishes the page sets it to the name the viewers use.
 */
export const CONNECTOR_NAME = "Pulse"

/** How long the runtime holds an answer no read uses any more (its cache's `gcTime`), 10 min. */
const KEEP_MS = 600_000

export interface CacheOptions {
  staleTime: number
  gcTime: number
  refresh?: boolean
}

/**
 * What a call resolves to: `payload`, maybe with `isError`; a raw `CallToolResult` is tolerated
 * too, as long as how a tool's error answer arrives is not known.
 */
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

/** A tool's error answer as MCP has it (`isError`), wherever the runtime puts one. */
function isErrorResult(value: unknown): value is ToolResult {
  return typeof value === "object" && value !== null && (value as ToolResult).isError === true
}

/**
 * An answer as the engine reads it (`resultData`): `payload` as the data, a text as the text, an
 * error answer with its text (`isError` on the answer, or a `payload` that is MCP's error result);
 * an answer without `payload` as the raw `CallToolResult` it may be.
 */
export function resultOf(answer: McpAnswer | null | undefined): ToolResult {
  if (answer === null || typeof answer !== "object" || !("payload" in answer)) return answer ?? {}
  const { payload, isError, content } = answer
  if (isErrorResult(payload)) {
    return { isError: true, content: payload.content ?? [{ type: "text", text: "" }] }
  }
  if (isError !== true && typeof payload !== "string") return { structuredContent: payload }
  const text = typeof payload === "string" ? payload : JSON.stringify(payload)
  return isError === true
    ? { isError, content: content ?? [{ type: "text", text }] }
    : { content: [{ type: "text", text }] }
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
