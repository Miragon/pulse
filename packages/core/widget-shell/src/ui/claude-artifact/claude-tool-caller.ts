import type { PageErrorCode } from "@miragon/pulse-ui"
import type { ToolResult } from "../../protocol/tool-result.js"
import type { ToolCaller } from "../browser-view-host.js"
import { PageCallError, type PageCallSite } from "../page-reads/page-call-error.js"
import { PAGE_READ_TTL_MS } from "../page-reads/page-reader.js"

/**
 * The only module that knows the artifact runtime: a page's `ToolCaller` over the `mcp`
 * capability of a Claude artifact, which calls a tool on one of the viewer's own connectors to an
 * MCP server, the Pulse MCP server say.
 *
 * VERIFIED on 2026-11-25 by a probe artifact in claude.ai (runtime contract 0.2.99) against a
 * Pulse MCP server:
 * 1. `window.claude.use("mcp")` resolves to a frozen namespace (`callTool`, `listTools`,
 *    `describeTool`, `server`, `invalidate`, `watchTool`).
 * 2. `callTool(server, tool, args, { cache })` takes positional arguments: `server` is the name
 *    the runtime knows the connector by (the caller's `connector`, or the one a call names), the
 *    name the `mcp` declaration gives it; `{ cache: { refresh: true } }` asks past the runtime's
 *    cache.
 * 3. It resolves to the tool's `CallToolResult` plus `payload`, the tool's JSON
 *    (`structuredContent`).
 * 4. Everything else rejects with a plain object `{ code, message, server }`, never an `Error`:
 *    a runtime refusal with its code (`CLAUDE_RUNTIME_CODES` below; `not_in_manifest` for a tool
 *    the declaration leaves out, without a round trip), and a tool's own error answer, strict
 *    input included, as `code: "tool_error"` with the tool's text as `message` and the result
 *    under `result`. A call never resolves with `isError`.
 *
 * STILL UNKNOWN: what `staleTime` and `gcTime` mean exactly (read here as ms, as TanStack Query
 * reads them); a call without them came back from the server, not from a cache.
 *
 * Publishing declares the capability with one entry per connector the page calls, each with the
 * tools it calls: `{ "mcp": { "servers": [{ "server": "<connector>", "tools": [<tools>] }] } }`;
 * a call to another tool is refused.
 */

/** How long the runtime holds an answer no read uses any more (its cache's `gcTime`), 10 min. */
const KEEP_MS = 600_000

/** The runtime's cache of a call: how long an answer is fresh and kept, and a fresh answer. */
export interface ClaudeCacheOptions {
  readonly staleTime: number
  readonly gcTime: number
  readonly refresh?: boolean
}

/** What a call resolves to: the tool's result with `payload`, its JSON. */
export type ClaudeMcpAnswer = ToolResult & { readonly payload?: unknown }

/** The runtime's `mcp` capability, the part a page calls. */
export interface ClaudeMcp {
  callTool(
    server: string,
    tool: string,
    args: Record<string, unknown>,
    options?: { readonly cache?: ClaudeCacheOptions },
  ): Promise<ClaudeMcpAnswer>
}

/** The slice of the artifact runtime (`window.claude`) a page uses. */
export interface ClaudeRuntime {
  use?(capability: "mcp"): Promise<ClaudeMcp | null | undefined>
}

/**
 * The runtime's refusal codes, each as pulse-ui's page error code (`PageErrorCode`), which the
 * page's words name; any other code is the page's `tool_error`. `server_not_connected` and
 * `selection_required` part in their words only: the viewer sets the connector up, or chooses
 * which of theirs the page uses. Which codes refuse the connector as a whole (`isPageWideRefusal`)
 * rests on the probe of 2026-11-25: probe the runtime again before a code changes sides.
 */
export const CLAUDE_RUNTIME_CODES: ReadonlyMap<string, PageErrorCode> = new Map([
  ["needs_reauth", "needs_reauth"],
  ["server_not_connected", "not_connected"],
  ["selection_required", "selection_required"],
  ["not_in_manifest", "not_allowed"],
  ["blocked_by_policy", "not_allowed"],
  ["approval_required", "approval_required"],
  ["server_unavailable", "unavailable"],
])

export interface ClaudeToolCallerOptions {
  /**
   * The page's own connector, by the name the runtime knows it under (the `mcp` declaration's
   * `server`); a call names another with its `connector` option.
   */
  readonly connector: string
  /** The artifact runtime; default the artifact's `window.claude`, read at the first call. */
  readonly runtime?: ClaudeRuntime
}

/** A page outside an artifact: no connector there, which a viewer opens it in claude.ai to have. */
const NO_RUNTIME = "window.claude.use is missing: the page runs outside a Claude artifact."
/** A page published without its `mcp` declaration: only whoever published it can declare it. */
const NO_CAPABILITY =
  'window.claude.use("mcp") gave no capability: the page declares no mcp capability.'

/** What a rejection of the runtime carries: its code, its text, a tool's result. */
interface Rejection {
  readonly code?: unknown
  readonly message?: unknown
  readonly result?: unknown
}

/** A rejection's fields: the runtime rejects with a plain object, anything else carries none. */
function fieldsOf(thrown: unknown): Rejection {
  const fields = thrown as Rejection | null | undefined
  return { code: fields?.code, message: fields?.message, result: fields?.result }
}

/** A rejection's text: its message; none for an object without one, never its `[object Object]`. */
function textOf(thrown: unknown): string {
  const { message } = fieldsOf(thrown)
  if (typeof message === "string") return message
  return typeof thrown === "object" && thrown !== null ? "" : String(thrown)
}

/**
 * A rejection as a refusal: a runtime code as the page's, its code shown before its message under
 * Details; any other code, or none, as `otherwise` with its message alone (else its code), so the
 * kit classifies a server's text.
 */
function refusalOf(thrown: unknown, otherwise: PageErrorCode, site?: PageCallSite): PageCallError {
  const { code } = fieldsOf(thrown)
  const text = textOf(thrown)
  const raw = typeof code === "string" ? code : ""
  const mapped = CLAUDE_RUNTIME_CODES.get(raw)
  if (mapped === undefined) return new PageCallError(otherwise, text || raw, site)
  return new PageCallError(mapped, text ? `[${raw}] ${text}` : `[${raw}]`, site)
}

function isErrorResult(value: unknown): value is ToolResult {
  return (value as { isError?: unknown } | null | undefined)?.isError === true
}

/**
 * A rejected call as the page reads it: a tool's own error (`tool_error`) as the `isError` answer
 * it is, so the kit words the server's text as in a chat; a refusal as a `PageCallError` of this
 * call's tool and connector (the capability's too, which no call named).
 */
function outcomeOf(thrown: unknown, site: PageCallSite): ToolResult | PageCallError {
  if (thrown instanceof PageCallError) return new PageCallError(thrown.code, thrown.detail, site)
  const { code, result } = fieldsOf(thrown)
  if (code === "tool_error") {
    return isErrorResult(result)
      ? result
      : { isError: true, content: [{ type: "text", text: textOf(thrown) }] }
  }
  return refusalOf(thrown, "tool_error", site)
}

/**
 * An answer as the caller resolves it: the tool's result with `payload` as its data, a text
 * payload (a tool that answers text only) as its text.
 */
function resultOf({ payload, ...result }: ClaudeMcpAnswer): ToolResult {
  if (typeof payload === "string") return { ...result, content: [{ type: "text", text: payload }] }
  if (payload === undefined || payload === null) return result
  return { ...result, structuredContent: payload }
}

/** The cache option of a call: the page's keep time, none for a fresh answer. */
function cacheOf(refresh: boolean | undefined): ClaudeCacheOptions {
  return refresh
    ? { staleTime: 0, gcTime: KEEP_MS, refresh: true }
    : { staleTime: PAGE_READ_TTL_MS, gcTime: KEEP_MS }
}

/**
 * The runtime's `mcp` capability; a refusal without the call's site, which its caller adds. No
 * runtime and a refused `use("mcp")` are `not_connected`, no capability (a page that declares
 * none) is `not_declared`: whoever published the page declares it, so its words send the viewer
 * there and offer no Try again.
 */
async function capabilityOf(runtime: ClaudeRuntime | undefined): Promise<ClaudeMcp> {
  const claude = runtime ?? (globalThis as { claude?: ClaudeRuntime }).claude
  if (typeof claude?.use !== "function") throw new PageCallError("not_connected", NO_RUNTIME)
  let mcp: ClaudeMcp | null | undefined
  try {
    mcp = await claude.use("mcp")
  } catch (thrown) {
    throw refusalOf(thrown, "not_connected")
  }
  if (mcp === null || mcp === undefined) throw new PageCallError("not_declared", NO_CAPABILITY)
  return mcp
}

/**
 * The page's caller over the artifact runtime (`runtime`, default `window.claude`): every call on
 * the page's `connector`, or on the one it names, kept in the runtime's cache as long as the page
 * keeps it, asked past it for `refresh`. It resolves a tool's answer, its own error included
 * (`isError`), and rejects a refusal of the runtime as a `PageCallError` in pulse-ui's code
 * (`CLAUDE_RUNTIME_CODES`), an unknown code as `tool_error`. One capability serves every
 * connector; a refusal forgets it, so the next try asks the runtime anew and a connector connected
 * meanwhile answers it.
 */
export function claudeToolCaller({ connector, runtime }: ClaudeToolCallerOptions): ToolCaller {
  let capability: Promise<ClaudeMcp> | undefined
  return async (tool, args, options = {}) => {
    const server = options.connector ?? connector
    try {
      capability ??= capabilityOf(runtime)
      const mcp = await capability
      return resultOf(await mcp.callTool(server, tool, args, { cache: cacheOf(options.refresh) }))
    } catch (thrown) {
      const outcome = outcomeOf(thrown, { tool, connector: server })
      if (!(outcome instanceof PageCallError)) return outcome
      if (outcome.code !== "tool_error") capability = undefined
      throw outcome
    }
  }
}
