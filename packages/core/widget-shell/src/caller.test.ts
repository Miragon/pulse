import { describe, expect, it } from "vitest"
import { resolveCaller } from "./caller.js"

const callerId = (ctx: unknown) => resolveCaller(ctx)?.userId

/** Tool, resource and prompt callbacks: the flattened `ctx.auth`. */
function callbackCtx(user: unknown, payload: Record<string, unknown> = {}) {
  return {
    auth: { user, payload, accessToken: "t", scopes: [], permissions: [], expiresAt: 0 },
  }
}

/** MCP middleware: the SDK `AuthInfo`, the provider mapping under `extra`. */
function middlewareCtx(user: unknown, payload: Record<string, unknown> = {}) {
  return {
    method: "tools/list",
    auth: { token: "t", clientId: "c", scopes: [], extra: { user, payload, permissions: [] } },
  }
}

describe("resolveCaller: the two mcp-use shapes", () => {
  it("reads the flattened callback shape (ctx.auth.user)", () => {
    expect(resolveCaller(callbackCtx({ id: "alice", roles: ["viewer"] }))).toEqual({
      userId: "alice",
    })
  })

  it("reads the middleware shape (ctx.auth.extra.user)", () => {
    expect(resolveCaller(middlewareCtx({ id: "alice" }))).toEqual({ userId: "alice" })
  })

  it("prefers the flattened user when a ctx carries both", () => {
    const ctx = { auth: { user: { id: "flat" }, extra: { user: { id: "nested" } } } }
    expect(resolveCaller(ctx)).toEqual({ userId: "flat" })
  })
})

describe("resolveCaller: field spellings", () => {
  it("takes id over userId over the token's sub", () => {
    expect(callerId(callbackCtx({ id: "by-id", userId: "u" }, { sub: "s" }))).toBe("by-id")
    expect(callerId(callbackCtx({ userId: "by-userId" }, { sub: "s" }))).toBe("by-userId")
    expect(callerId(callbackCtx({}, { sub: "by-sub" }))).toBe("by-sub")
  })

  it("falls back to the token's sub in the middleware shape too (extra.payload)", () => {
    expect(callerId(middlewareCtx({ roles: [] }, { sub: "carol" }))).toBe("carol")
  })

  it("skips empty and non-string ids instead of coercing them", () => {
    expect(callerId(callbackCtx({ id: "", userId: "fallback" }))).toBe("fallback")
    expect(callerId(callbackCtx({ id: 42 }, { sub: 7 }))).toBeUndefined()
  })
})

describe("resolveCaller: anonymous against authenticated without an id", () => {
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "ctx"],
    ["a ctx without auth", { method: "tools/list" }],
    ["a ctx with auth: null", { auth: null }],
    ["a ctx with a non-object auth", { auth: "bearer" }],
  ])("returns undefined for %s", (_label, ctx) => {
    expect(resolveCaller(ctx)).toBeUndefined()
    expect(callerId(ctx)).toBeUndefined()
  })

  it("returns a caller without userId when auth maps no subject", () => {
    // This request is authenticated, so per-user data must be refused, not widened.
    expect(resolveCaller({ auth: {} })).toEqual({})
    expect(resolveCaller(middlewareCtx("not-an-object"))).toEqual({})
    expect(resolveCaller(callbackCtx({ roles: ["viewer"] }))).toEqual({})
  })

  it.each([
    ["null", null],
    ["a string", "x"],
    ["an array", []],
    ["a numeric auth", { auth: 1 }],
    ["a scalar user and extra", { auth: { user: 5, extra: "y" } }],
    ["a numeric id", { auth: { user: { id: 7 } } }],
  ])("never throws on %s and yields undefined or a well-formed caller", (_label, ctx) => {
    const caller = resolveCaller(ctx)
    const wellFormed =
      caller === undefined ||
      (Object.keys(caller).every((key) => key === "userId") &&
        (caller.userId === undefined || typeof caller.userId === "string"))
    expect(wellFormed).toBe(true)
  })
})
