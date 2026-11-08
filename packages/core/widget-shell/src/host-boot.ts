/** Small boot helpers: the listen port and how the metrics read a tool call. */

/** Structural: the app's `mcp:tools/call` hook, as the metrics install it. */
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
    throw new Error(`${prefix}invalid PORT "${env.PORT}": expected an integer 1-65535`)
  }
  return port
}
