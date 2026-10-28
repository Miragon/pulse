/** mcp-use workarounds for composed-server hosts, so a migration lands here once. */

/** Structural, so callers pass an `MCPServer` without this module importing mcp-use. */
export interface ToolCallMiddlewareHost {
  use(
    pattern: "mcp:tools/call",
    fn: (ctx: unknown, next: () => Promise<unknown>) => Promise<unknown>,
  ): unknown
}

export function toolNameOf(ctx: unknown): string {
  return (ctx as { params?: { name?: string } } | undefined)?.params?.name ?? "unknown"
}

/** Handlers report failures as `isError` results, not throws. */
export function toolCallOutcome(result: unknown): "ok" | "error" {
  const isError =
    typeof result === "object" &&
    result !== null &&
    (result as { isError?: unknown }).isError === true
  return isError ? "error" : "ok"
}

/**
 * Above `info`, `MCP_USE_LOG_LEVEL` logs tool inputs/outputs or full dumps with headers: process
 * variables, business keys and bearer tokens reach the log. The boot says so.
 */
export function requestLogLevelWarning(env: NodeJS.ProcessEnv): string | undefined {
  const level = env.MCP_USE_LOG_LEVEL?.trim().toLowerCase()
  if (level !== "debug" && level !== "trace") return undefined
  return level === "trace"
    ? "MCP_USE_LOG_LEVEL=trace — mcp-use logs every request and response in full, headers (bearer tokens) included. For debugging only."
    : "MCP_USE_LOG_LEVEL=debug — mcp-use logs tool inputs and outputs (process variables, business keys) on every call. For debugging only."
}

/**
 * `mcp-use dev` primes its own empty views manifest onto the default export, which mcp-use rejects
 * as a double prime. Swallowed only under the dev CLI, so a genuine double prime still fails.
 */
export function swallowDevCliViewsPrime(
  server: object,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!env.MCP_USE_DEV_CLI) return
  ;(server as { __primeViews: () => void }).__primeViews = () => {}
}

export interface ResolvePortOptions {
  env?: NodeJS.ProcessEnv
  fallback?: number
  label?: string
}

/** `||`, not `??`: an empty `PORT=` must fall back, since `Number("")` is 0 (a random port). */
export function resolvePort({
  env = process.env,
  fallback = 8400,
  label,
}: ResolvePortOptions = {}): number {
  const port = Number(env.PORT?.trim() || fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    const prefix = label ? `[${label}] ` : ""
    throw new Error(`${prefix}invalid PORT "${env.PORT}" — expected an integer 1-65535`)
  }
  return port
}
