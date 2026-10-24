/**
 * The OAuth provider's proactive refresh on the fake runtime and the fake identity provider:
 * rotation, the lock, fallbacks and the hints of rejected refresh tokens.
 */

import { describe, expect, it } from "vitest"
import { connectionRefused } from "../../../test/support/fake-fetch.js"
import { oauthError } from "../../../test/support/fake-idp.js"
import { rejection, setup, T0 } from "../../../test/support/oauth-provider.js"
import { cachedLogin, cacheText, oauthConfig, TOKEN_FILE } from "../../../test/support/oauth.js"
import { oauthAuth } from "./provider.js"

const HINT =
  "Run `pulse-cli auth login --profile p` in a terminal: a person logs in once in the browser, pulse-cli refreshes the token afterwards. Agents cannot log in themselves."

describe("OAuth provider: proactive refresh", () => {
  it("refreshes from min(60 s, lifetime/2) before expiry on, not before", async () => {
    const before = setup()
    before.clock = T0 + 239_999
    await before.provider().headers()
    expect(before.idp.tokenRequests()).toEqual([])
    const at = setup()
    at.clock = T0 + 240_000
    await expect(at.provider().headers()).resolves.toEqual({ Authorization: "Bearer access-1" })
    expect(
      at.idp.tokenRequests("refresh_token").map((request) => request.form.get("refresh_token")),
    ).toEqual(["cached-refresh"])
  })

  it("stores the rotated refresh token and the new expiries", async () => {
    const test = setup(undefined, { idp: { expiresIn: 300, refreshExpiresIn: 1800 } })
    test.clock = T0 + 250_000
    await test.provider().headers()
    expect(test.stored()).toMatchObject({
      accessToken: "access-1",
      expiresAt: T0 + 550_000,
      refreshToken: "refresh-1",
      refreshExpiresAt: T0 + 250_000 + 1_800_000,
      refreshedAt: T0 + 250_000,
      loggedInAt: T0,
      tokenType: "Bearer",
    })
    expect(test.runtime.files.get(TOKEN_FILE)?.mode).toBe(0o600)
  })

  it("keeps the old refresh token and its expiry when the server returns none", async () => {
    const test = setup(undefined, { idp: { rotate: false, refreshExpiresIn: null } })
    test.clock = T0 + 250_000
    await test.provider().headers()
    expect(test.stored()).toMatchObject({
      accessToken: "access-1",
      refreshToken: "cached-refresh",
      refreshExpiresAt: T0 + 1_800_000,
    })
  })

  it("forgets the refresh expiry after a rotation without refresh_expires_in", async () => {
    const test = setup(undefined, { idp: { refreshExpiresIn: null, expiresIn: null } })
    test.clock = T0 + 250_000
    await test.provider().headers()
    expect(test.stored()).toMatchObject({
      refreshToken: "refresh-1",
      refreshExpiresAt: null,
      expiresAt: null,
    })
  })

  it("keeps the display values when the refresh has none", async () => {
    const test = setup(undefined, { idp: { idToken: null, scope: null } })
    test.clock = T0 + 250_000
    await test.provider().headers()
    expect(test.stored()).toMatchObject({
      user: "alice",
      subject: "user-1",
      scope: "openid offline_access",
    })
    const updated = setup(undefined, {
      idp: { idToken: { sub: "s-2", preferred_username: "bob" }, scope: "openid" },
    })
    updated.clock = T0 + 250_000
    await updated.provider().headers()
    expect(updated.stored()).toMatchObject({ user: "bob", subject: "s-2", scope: "openid" })
  })

  it("holds the lock for the timeout plus 10 s", async () => {
    const test = setup(undefined, { deps: { timeoutMs: 4_000 } })
    test.clock = T0 + 250_000
    await test.provider().headers()
    expect(test.runtime.locks).toEqual([{ path: `${TOKEN_FILE}.lock`, holdMs: 14_000 }])
  })

  it("falls back to the valid token after a network error, a server error or a lock timeout", async () => {
    const network = setup()
    network.idp.queue("token", connectionRefused())
    network.clock = T0 + 250_000
    await expect(network.provider().headers()).resolves.toEqual({
      Authorization: "Bearer cached-access",
    })
    const server = setup()
    server.idp.queue("token", new Response("", { status: 503 }))
    server.clock = T0 + 250_000
    await expect(server.provider().headers()).resolves.toEqual({
      Authorization: "Bearer cached-access",
    })
    const locked = setup(undefined, { runtime: { lockTimeout: true } })
    locked.clock = T0 + 250_000
    await expect(locked.provider().headers()).resolves.toEqual({
      Authorization: "Bearer cached-access",
    })
    expect(locked.idp.requests).toEqual([])
  })

  it("notes the fallback in the --verbose trace", async () => {
    const events: unknown[] = []
    const test = setup(undefined, { deps: { trace: (event) => events.push(event) } })
    test.idp.queue("token", new Response("", { status: 503 }))
    test.clock = T0 + 250_000
    await test.provider().headers()
    expect(events.at(-1)).toEqual({
      type: "note",
      message:
        "Refreshing the access token failed (The authorization server failed: HTTP 503 Service Unavailable); using the cached one, valid until 2023-11-14T22:18:20.000Z.",
    })
    const quiet = setup(undefined, { deps: { trace: (event) => events.push(event) } })
    events.length = 0
    await quiet.provider().headers()
    expect(events).toEqual([])
  })

  it("does not fall back for an expired token or a rejected login", async () => {
    const expired = setup()
    expired.idp.queue("token", connectionRefused())
    expired.clock = T0 + 300_000
    expect((await rejection(expired.provider().headers())).code).toBe("NETWORK")
    const locked = setup(undefined, { runtime: { lockTimeout: true } })
    locked.clock = T0 + 300_000
    expect((await rejection(locked.provider().headers())).message).toBe(
      `Cannot lock the token cache ${TOKEN_FILE}`,
    )
    const rejected = setup()
    rejected.idp.queue("token", oauthError(400, "invalid_grant", "Session not active"))
    rejected.clock = T0 + 250_000
    expect((await rejection(rejected.provider().headers())).code).toBe("LOGIN_REQUIRED")
    const client = setup()
    client.idp.queue("token", oauthError(401, "unauthorized_client"))
    client.clock = T0 + 250_000
    expect((await rejection(client.provider().headers())).code).toBe("CONFIG")
  })

  it("records a refused refresh token, tokens unchanged, so that nothing asks again", async () => {
    const test = setup()
    const before = test.stored()
    test.idp.queue(
      "token",
      oauthError(400, "invalid_grant", "Maximum allowed refresh token reuse exceeded"),
    )
    test.clock = T0 + 250_000
    const error = await rejection(test.provider().headers())
    expect(error.message).toBe(
      'The authorization server rejected the refresh token of profile "p" (invalid_grant: Maximum allowed refresh token reuse exceeded)',
    )
    expect(test.stored()).toEqual({
      ...before,
      refreshRejected: {
        at: T0 + 250_000,
        error: "invalid_grant: Maximum allowed refresh token reuse exceeded",
      },
    })
    expect(test.runtime.files.get(TOKEN_FILE)?.mode).toBe(0o600)

    // later commands fail at once, the dry-run says so, a reactive refresh sends nothing
    test.clock = T0 + 260_000
    const later = await rejection(test.provider().headers())
    expect(later.message).toBe(
      'The authorization server rejected the refresh token of profile "p" at 2023-11-14T22:17:30.000Z (invalid_grant: Maximum allowed refresh token reuse exceeded)',
    )
    expect(later.details.hint).toBe(
      `The session expired, was revoked, or the refresh token was replayed. ${HINT}`,
    )
    await expect(test.provider().preview?.()).resolves.toEqual({
      headers: { Authorization: "Bearer cached-access" },
      note: "The authorization server rejected the refresh token at 2023-11-14T22:17:30.000Z: the request would fail with LOGIN_REQUIRED. Run `pulse-cli auth login --profile p` in a terminal.",
    })
    expect((await rejection(test.provider().refresh?.() ?? Promise.resolve())).message).toBe(
      later.message,
    )
    expect(test.idp.tokenRequests()).toHaveLength(1)
  })

  it("records other refused refreshes, never client errors or server failures", async () => {
    const refused = setup()
    refused.idp.queue("token", oauthError(400, "not_allowed", "Offline tokens not allowed"))
    refused.clock = T0 + 250_000
    await rejection(refused.provider().headers())
    expect(refused.stored().refreshRejected).toEqual({
      at: T0 + 250_000,
      error: "not_allowed: Offline tokens not allowed",
    })
    for (const answer of [
      oauthError(401, "invalid_client", "Invalid client credentials"),
      new Response("", { status: 503 }),
    ]) {
      const test = setup()
      test.idp.queue("token", answer)
      test.clock = T0 + 300_000
      await rejection(test.provider().headers())
      expect(test.stored()).not.toHaveProperty("refreshRejected")
    }
  })

  it("reports the refusal even when it cannot be recorded", async () => {
    const test = setup()
    test.idp.queue("token", oauthError(400, "invalid_grant", "Session not active"))
    test.clock = T0 + 250_000
    const auth = oauthAuth(oauthConfig(), {
      ...test.deps,
      fs: { ...test.deps.fs, writeFile: () => Promise.reject(new Error("EROFS")) },
    })
    expect((await rejection(auth.headers())).code).toBe("LOGIN_REQUIRED")
  })

  it("adopts a new login that replaced a refused one", async () => {
    const test = setup(
      cachedLogin(T0, { refreshRejected: { at: T0, error: "invalid_grant: x" }, expiresAt: T0 }),
    )
    const auth = test.provider()
    // this process read the refused login (a dry-run preview reads the cache)
    expect((await auth.preview?.())?.note).toContain("rejected the refresh token")
    test.runtime.files.set(TOKEN_FILE, {
      data: new TextEncoder().encode(cacheText(cachedLogin(T0, { accessToken: "new-login" }))),
    })
    await expect(auth.refresh?.()).resolves.toBe(true)
    await expect(auth.headers()).resolves.toEqual({ Authorization: "Bearer new-login" })
    expect(test.idp.requests).toEqual([])
  })

  it("shares one refresh between concurrent calls of one process", async () => {
    const test = setup()
    test.clock = T0 + 250_000
    const auth = test.provider()
    const headers = await Promise.all([auth.headers(), auth.headers(), auth.headers()])
    expect(headers).toEqual(Array(3).fill({ Authorization: "Bearer access-1" }))
    expect(test.idp.tokenRequests()).toHaveLength(1)
    expect(test.runtime.locks).toHaveLength(1)
  })
})
