import { describe, expect, it } from "vitest"
import { callerUserId } from "./caller.js"

/** MCP middleware: the SDK `AuthInfo`, the provider mapping under `extra`. */
function middlewareCtx(user: unknown, payload: Record<string, unknown> = {}) {
  return {
    method: "tools/list",
    auth: { token: "t", clientId: "c", scopes: [], extra: { user, payload, permissions: [] } },
  }
}

describe("callerUserId: field spellings", () => {
  it("reads the provider's user under ctx.auth.extra", () => {
    expect(callerUserId(middlewareCtx({ id: "alice", roles: ["viewer"] }))).toBe("alice")
  })

  it("takes id over userId over the token's sub", () => {
    expect(callerUserId(middlewareCtx({ id: "by-id", userId: "u" }, { sub: "s" }))).toBe("by-id")
    expect(callerUserId(middlewareCtx({ userId: "by-userId" }, { sub: "s" }))).toBe("by-userId")
    expect(callerUserId(middlewareCtx({ roles: [] }, { sub: "by-sub" }))).toBe("by-sub")
  })

  it("skips empty and non-string ids instead of coercing them", () => {
    expect(callerUserId(middlewareCtx({ id: "", userId: "fallback" }))).toBe("fallback")
    expect(callerUserId(middlewareCtx({ id: 42 }, { sub: 7 }))).toBeUndefined()
  })
})

describe("callerUserId: no caller", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "ctx"],
    ["an array", []],
    ["a ctx without auth", { method: "tools/list" }],
    ["a ctx with auth: null", { auth: null }],
    ["a ctx with a non-object auth", { auth: "bearer" }],
    ["an auth without extra", { auth: { token: "t" } }],
    ["a scalar extra", { auth: { extra: "y" } }],
    ["a scalar user and payload", middlewareCtx("not-an-object", { sub: 5 })],
  ])("returns undefined for %s", (_label, ctx) => {
    expect(callerUserId(ctx)).toBeUndefined()
  })
})
