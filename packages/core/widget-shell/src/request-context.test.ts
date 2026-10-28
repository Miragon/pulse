import { describe, expect, it } from "vitest"
import {
  callerCacheKey,
  getMcpRequestInfo,
  installMcpRequestContext,
  runWithMcpRequestInfo,
  type McpMiddlewareHost,
} from "./request-context.js"

type Middleware = (ctx: unknown, next: () => Promise<void>) => Promise<void>

/** Minimal server double capturing what `installMcpRequestContext` registers. */
function fakeServer() {
  const middlewares: Middleware[] = []
  const server: McpMiddlewareHost = {
    use: (_pattern, fn) => {
      middlewares.push(fn)
      return server
    },
  }
  return { server, middlewares }
}

/** What the installed middleware hands the handler for `ctx`. */
async function seenFor(ctx: unknown): Promise<unknown> {
  const { server, middlewares } = fakeServer()
  installMcpRequestContext(server)
  let seen: unknown = "sentinel"
  await middlewares[0](ctx, async () => {
    seen = getMcpRequestInfo()
  })
  return seen
}

describe("runWithMcpRequestInfo / getMcpRequestInfo", () => {
  it("is undefined outside a request", () => {
    expect(getMcpRequestInfo()).toBeUndefined()
  })

  it("exposes the info inside the run scope only", () => {
    const inside = runWithMcpRequestInfo({ anonymousCaller: true }, () => getMcpRequestInfo())
    expect(inside).toEqual({ anonymousCaller: true })
    expect(getMcpRequestInfo()).toBeUndefined()
  })
})

/** Who calls AND with which credential, never the credential itself. */
describe("callerCacheKey", () => {
  const ALICE = { authUserId: "alice", authorization: "Bearer token-alice" }

  it("is empty outside a request and for a request without a caller or a credential", () => {
    expect(callerCacheKey()).toBe("")
    expect(runWithMcpRequestInfo({ anonymousCaller: true }, callerCacheKey)).toBe("")
  })

  it("is stable for one caller and credential, and keeps no credential", () => {
    const key = runWithMcpRequestInfo(ALICE, callerCacheKey)
    expect(key).toMatch(/^[\w-]{43}$/)
    expect(key).not.toContain("token-alice")
    expect(runWithMcpRequestInfo({ ...ALICE }, callerCacheKey)).toBe(key)
  })

  it("tells callers and credentials apart, each on its own", () => {
    const keys = [
      ALICE,
      { ...ALICE, authorization: "Bearer token-alice-2" },
      { ...ALICE, authUserId: "bob" },
      { authUserId: "alice" },
      { authorization: "Bearer token-alice" },
      { authUserId: "alice\nBearer", authorization: "token-alice" },
    ].map((info) => runWithMcpRequestInfo(info, callerCacheKey))
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys).not.toContain("")
  })
})

describe("installMcpRequestContext", () => {
  it("registers exactly one middleware, even when installed twice", () => {
    const { server, middlewares } = fakeServer()
    installMcpRequestContext(server)
    installMcpRequestContext(server)
    expect(middlewares).toHaveLength(1)
  })

  it("derives the OAuth caller and the Authorization header for downstream handlers", async () => {
    const headers: Record<string, string> = { Authorization: "Bearer tok-123" }
    // The middleware auth shape: the SDK AuthInfo, provider user under `extra`.
    const ctx = {
      request: { header: (name: string) => headers[name] },
      auth: { token: "tok-123", extra: { user: { id: "user-7" }, payload: { sub: "user-7" } } },
    }
    expect(await seenFor(ctx)).toEqual({ authUserId: "user-7", authorization: "Bearer tok-123" })
  })

  it("never turns a client-chosen Mcp-Session-Id into an identity", async () => {
    const headers: Record<string, string> = {
      "mcp-session-id": "victim",
      "Mcp-Session-Id": "victim",
    }
    const ctx = {
      request: { header: (name: string) => headers[name] },
      session: { sessionId: "victim" },
    }
    expect(await seenFor(ctx)).toEqual({ authUserId: undefined, authorization: undefined })
  })

  it("never declares an anonymous caller — only runWithMcpRequestInfo can", async () => {
    expect(await seenFor({})).toEqual({ authUserId: undefined, authorization: undefined })
  })

  it("ignores a non-string auth user id and a throwing header accessor", async () => {
    const ctx = {
      request: {
        header: () => {
          throw new Error("no request")
        },
      },
      auth: { extra: { user: { id: 42 } } },
    }
    expect(await seenFor(ctx)).toEqual({ authUserId: undefined, authorization: undefined })
  })
})
