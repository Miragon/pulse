import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  ANONYMOUS_PROFILE_KEY,
  resolveAuthUserId,
  resolveProfileKey,
  withoutDefaults,
} from "./profile.js"
import { runWithMcpRequestInfo } from "./request-context.js"

/** A tool-handler `ctx` as mcp-use hands it to callbacks (flattened `auth.user`). */
const authed = (user: Record<string, unknown>) => ({ auth: { user, payload: {} } })

describe("resolveProfileKey", () => {
  it("resolves the OAuth caller from the handler ctx (any provider spelling)", () => {
    expect(resolveProfileKey(authed({ id: "user-1" }))).toBe("user-1")
    expect(resolveProfileKey(authed({ userId: "user-2" }))).toBe("user-2")
    expect(resolveProfileKey({ auth: { payload: { sub: "user-3" } } })).toBe("user-3")
  })

  it("lets an authenticated ctx decide alone — no subject is NO key, never a fallback", () => {
    const anonymous = { anonymousCaller: true }
    expect(runWithMcpRequestInfo(anonymous, () => resolveProfileKey(authed({ id: "" })))).toBe(
      undefined,
    )
    expect(
      runWithMcpRequestInfo({ authUserId: "user-9" }, () => resolveProfileKey(authed({ id: 42 }))),
    ).toBeUndefined()
  })

  it("never takes the caller from the ambient request info, only from the handler ctx", () => {
    expect(
      runWithMcpRequestInfo({ authUserId: "user-7" }, () => resolveProfileKey()),
    ).toBeUndefined()
    expect(
      runWithMcpRequestInfo({ authUserId: "user-7" }, () => resolveProfileKey({})),
    ).toBeUndefined()
  })

  it("resolves the anonymous key only for an EXPLICITLY declared local caller", () => {
    expect(runWithMcpRequestInfo({ anonymousCaller: true }, () => resolveProfileKey())).toBe(
      ANONYMOUS_PROFILE_KEY,
    )
  })

  it("fails closed: no request context (missing middleware install) is no identity", () => {
    expect(resolveProfileKey()).toBeUndefined()
    expect(resolveProfileKey({})).toBeUndefined()
  })

  it("fails closed: an HTTP request without OAuth is no identity", () => {
    expect(runWithMcpRequestInfo({}, () => resolveProfileKey())).toBeUndefined()
    expect(
      runWithMcpRequestInfo({ authorization: "Bearer x" }, () => resolveProfileKey()),
    ).toBeUndefined()
  })
})

describe("resolveAuthUserId", () => {
  it("returns only the OAuth caller, never the anonymous key", () => {
    expect(resolveAuthUserId(authed({ id: "user-1" }))).toBe("user-1")
    expect(
      runWithMcpRequestInfo({ authUserId: "user-7" }, () => resolveAuthUserId()),
    ).toBeUndefined()
    expect(runWithMcpRequestInfo({ anonymousCaller: true }, () => resolveAuthUserId())).toBe(
      undefined,
    )
    expect(resolveAuthUserId()).toBeUndefined()
    expect(resolveAuthUserId({ auth: {} })).toBeUndefined()
  })
})

describe("withoutDefaults", () => {
  const schema = z.object({
    period: z.enum(["7d", "30d"]).default("7d").describe("Look-back window."),
    limit: z.number().int().default(10),
    optional: z.string().optional(),
  })

  it("keeps omitted fields ABSENT instead of materializing defaults (the zod-4 partial trap)", () => {
    // The trap this guards: `schema.partial()` re-applies the defaults on parse.
    expect(schema.partial().parse({})).toEqual({ period: "7d", limit: 10 })

    const saveInput = z.object(withoutDefaults(schema.shape)).partial()
    expect(saveInput.parse({})).toEqual({})
    expect(saveInput.parse({ limit: 3 })).toEqual({ limit: 3 })
  })

  it("preserves each field's description (the model reads them at the tool boundary)", () => {
    const stripped = withoutDefaults(schema.shape)
    expect((stripped.period as z.ZodType).description).toBe("Look-back window.")
  })

  it("still validates the stripped fields", () => {
    const saveInput = z.object(withoutDefaults(schema.shape)).partial()
    expect(saveInput.safeParse({ period: "nope" }).success).toBe(false)
    expect(saveInput.safeParse({ period: "30d" }).success).toBe(true)
  })

  it("passes fields that carry no default through untouched", () => {
    const stripped = withoutDefaults(schema.shape)
    expect(stripped.optional).toBe(schema.shape.optional)
  })
})
