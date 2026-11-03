/**
 * Ambient request info for consumers WITHOUT a handler `ctx`: the per-caller caches
 * (`callerCacheKey`) and the engine passthrough-auth interceptor deep in a hey-api
 * chain. Without the middleware nothing is forwarded (passthrough fails with the engine's
 * 401) and every caller shares the "" cache partition, which is safe only because no
 * per-caller token reaches the engine. `/server` only: `node:async_hooks` must
 * never reach the widget bundle.
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { createHash } from "node:crypto"
import { callerUserId } from "./caller.js"

export interface McpRequestInfo {
  authUserId?: string
  authorization?: string
}

const storage = new AsyncLocalStorage<McpRequestInfo>()

export function getMcpRequestInfo(): McpRequestInfo | undefined {
  return storage.getStore()
}

/**
 * Hashed so no credential is kept. With passthrough auth the engine answers with each
 * caller's own permissions, so a cached answer must never serve another caller.
 */
export function callerCacheKey(): string {
  const info = storage.getStore()
  if (!info?.authUserId && !info?.authorization) return ""
  return createHash("sha256")
    .update(JSON.stringify([info.authUserId ?? null, info.authorization ?? null]))
    .digest("base64url")
}

/** The test seam. */
export function runWithMcpRequestInfo<T>(info: McpRequestInfo, fn: () => T): T {
  return storage.run(info, fn)
}

/** Structural so mcp-use's type stays out of the public surface. */
interface MiddlewareCtxLike {
  request?: { header(name: string): string | undefined }
  auth?: unknown
}

function deriveInfo(ctx: MiddlewareCtxLike): McpRequestInfo {
  const header = (name: string): string | undefined => {
    try {
      return ctx.request?.header(name)
    } catch {
      return undefined
    }
  }
  return {
    authUserId: callerUserId(ctx),
    authorization: header("Authorization") ?? header("authorization"),
  }
}

/** Structural so this module need not import mcp-use. */
export interface McpMiddlewareHost {
  use(pattern: "mcp:*", fn: (ctx: unknown, next: () => Promise<void>) => Promise<void>): unknown
}

const installed = new WeakSet<McpMiddlewareHost>()

export function installMcpRequestContext(server: McpMiddlewareHost): void {
  if (installed.has(server)) return
  installed.add(server)
  server.use("mcp:*", (ctx, next) => storage.run(deriveInfo(ctx as MiddlewareCtxLike), next))
}
