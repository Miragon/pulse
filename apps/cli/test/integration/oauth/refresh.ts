/**
 * Refresh and logout in the OAuth suite: proactive, parallel and reactive refreshes, expired and
 * ended sessions, logout, shared logins, old caches, and tokens of another audience or issuer.
 */

import { existsSync } from "node:fs"
import { readdir, rename } from "node:fs/promises"
import { basename, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { expect, it } from "vitest"
import { globalFlag } from "../support/catalog.js"
import { expectError, expectSuccess } from "../support/expect.js"
import { claimsOf } from "../support/jwt.js"
import { adminLogout, CLIENTS, endpointsOf, refreshRequest, USER } from "../support/keycloak.js"
import { readCache, tokenDirectory, writeCache } from "../support/token-cache.js"
import { SENT_REQUEST, tokenRequests, traceOf } from "../support/trace.js"
import type { Count, LogoutOutput } from "../support/types.js"
import { authArgs, countArgs, PROFILE, type OAuthSuite } from "./suite.js"

export function registerRefresh(suite: OAuthSuite): void {
  const { top, LOGIN_HINT, tokenEndpoint, cacheFile, trace, COUNT_REQUEST, run, login } = suite

  it("refreshes the access token before it expires and stores each rotated refresh token", async () => {
    let { cache } = await login(PROFILE.short)
    let spent = ""
    for (let round = 1; round <= 3; round += 1) {
      // a 5 s token needs a refresh from 2.5 s on (margin: half the lifetime, at most 60 s)
      await sleep(3_000)
      const result = await run(countArgs(PROFILE.short, globalFlag("verbose")))
      expectSuccess(result)
      expect(trace(result), `round ${round}`).toEqual([
        "> POST <token>",
        "< 200",
        COUNT_REQUEST,
        "< 200",
      ])
      const next = await readCache(cacheFile(PROFILE.short))
      expect(next.accessToken).not.toBe(cache.accessToken)
      expect(next.refreshToken).toEqual(expect.any(String))
      expect(next.refreshToken).not.toBe(cache.refreshToken)
      expect(next.refreshedAt).toBeGreaterThan(cache.refreshedAt ?? cache.loggedInAt)
      const lifetime = (next.expiresAt ?? 0) - (next.refreshedAt ?? 0)
      // Keycloak answers expires_in = exp - now in whole seconds: 4 when a second boundary passes
      expect(lifetime).toBeGreaterThanOrEqual(4_000)
      expect(lifetime).toBeLessThanOrEqual(5_000)
      spent = cache.refreshToken ?? ""
      cache = next
    }
    // pulse-cli really sent the previous refresh token: Keycloak treats a second use as a replay
    // (this ends the session, so it is the last step)
    const replay = await refreshRequest(top().issuer, CLIENTS.short, spent)
    expect(replay).toMatchObject({ status: 400, body: { error: "invalid_grant" } })
  })

  it("makes one token request for six parallel commands that all need a refresh", async () => {
    const { cache } = await login(PROFILE.it)
    // the 300 s token stays valid at the gateway, but every command now wants to refresh it
    await writeCache(cacheFile(PROFILE.it), { expiresAt: Date.now() - 1_000 })
    const results = await Promise.all(
      Array.from({ length: 6 }, () => run(countArgs(PROFILE.it, globalFlag("verbose")))),
    )
    for (const result of results) expectSuccess(result)
    // one leader refreshes under the lock; the others adopt its token from the file
    expect(
      tokenRequests(
        results.map((result) => result.stderr),
        tokenEndpoint(),
      ),
    ).toBe(1)
    const refreshed = await readCache(cacheFile(PROFILE.it))
    expect(refreshed.refreshToken).not.toBe(cache.refreshToken)
    expect(refreshed.refreshedAt).toEqual(expect.any(Number))

    // the session is alive (a second refresh with the same token would have ended it)
    const after = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    expect(trace(expectSuccess(after))).toEqual([COUNT_REQUEST, "< 200"])
  })

  it("refreshes once after the gateway rejects an expired access token with 401", async () => {
    const { cache } = await login(PROFILE.short)
    // the gateway's clock decides; wait until the token is expired there (1 s skew allowed)
    const expiry = Math.max(Number(claimsOf(cache.accessToken).exp) * 1_000, cache.expiresAt ?? 0)
    await sleep(Math.max(0, expiry + 2_500 - Date.now()))
    const expired = await fetch(`${top().url}/version`, {
      headers: { authorization: `Bearer ${cache.accessToken}` },
    })
    expect(expired.status).toBe(401)
    expect(await expired.text()).toBe("Jwt is expired")
    // pulse-cli believes the token is good for another hour and sends it
    await writeCache(cacheFile(PROFILE.short), { expiresAt: Date.now() + 3_600_000 })

    const result = await run(countArgs(PROFILE.short, globalFlag("verbose")))
    expect(expectSuccess(result).json<Count>()).toEqual({ count: expect.any(Number) })
    expect(trace(result)).toEqual([
      COUNT_REQUEST,
      "< 401",
      "> POST <token>",
      "< 200",
      COUNT_REQUEST,
      "< 200",
    ])
    const refreshed = await readCache(cacheFile(PROFILE.short))
    expect(refreshed.accessToken).not.toBe(cache.accessToken)
    expect(refreshed.refreshToken).not.toBe(cache.refreshToken)
    expect(refreshed.expiresAt).toBeLessThan(Date.now() + 60_000)
  })

  it("asks for a new login when the refresh token is expired, missing or rejected", async () => {
    const { cache } = await login(PROFILE.it)
    const file = cacheFile(PROFILE.it)
    const past = Date.now() - 60_000
    const pastIso = new Date(past).toISOString()

    await writeCache(file, { expiresAt: past, refreshExpiresAt: past })
    const expired = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    const expiredError = expectError(expired, "LOGIN_REQUIRED", 4)
    expect(expiredError.message).toBe(`The OAuth login of profile "it" expired at ${pastIso}`)
    expect(expiredError.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(expired.stderr).not.toMatch(SENT_REQUEST)
    expectError(await run(authArgs("status", PROFILE.it)), "LOGIN_REQUIRED", 4)

    await writeCache(file, { expiresAt: past, refreshToken: null, refreshExpiresAt: null })
    const missing = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    const missingError = expectError(missing, "LOGIN_REQUIRED", 4)
    expect(missingError.message).toBe(
      `The access token of profile "it" expired at ${pastIso} and there is no refresh token`,
    )
    expect(missingError.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(missingError.hint).toContain("offline_access")
    expect(missing.stderr).not.toMatch(SENT_REQUEST)

    const garbage = "not-a-refresh-token-it"
    suite.ledger.add(garbage)
    await writeCache(file, {
      expiresAt: past,
      refreshToken: garbage,
      refreshExpiresAt: cache.refreshExpiresAt,
    })
    const before = await readCache(file)
    const rejected = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    const rejectedError = expectError(rejected, "LOGIN_REQUIRED", 4)
    expect(rejectedError.message).toContain("invalid_grant")
    expect(rejectedError.message).toContain("Invalid refresh token")
    expect(rejectedError.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(trace(rejected)).toEqual(["> POST <token>", "< 400"])
    // a refused refresh keeps the tokens and records the refusal: only login and logout
    // replace a login, and auth status and later commands know without asking again
    expect(await readCache(file)).toEqual({
      ...before,
      refreshRejected: {
        at: expect.any(Number) as number,
        error: "invalid_grant: Invalid refresh token",
      },
    })
    const status = await run(authArgs("status", PROFILE.it))
    expect(expectError(status, "LOGIN_REQUIRED", 4).message).toMatch(
      /^The authorization server rejected the refresh token of profile "it" at \S+ \(invalid_grant: Invalid refresh token\)$/,
    )
    const again = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    expect(expectError(again, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(again.stderr).not.toMatch(SENT_REQUEST)
  })

  it("asks for a new login when the session ended at the authorization server", async () => {
    await login(PROFILE.online)
    await adminLogout(top().keycloakUrl, USER.username)
    await writeCache(cacheFile(PROFILE.online), { expiresAt: Date.now() - 1_000 })
    const result = await run(countArgs(PROFILE.online, globalFlag("verbose")))
    const error = expectError(result, "LOGIN_REQUIRED", 4)
    expect(error.message).toContain("invalid_grant")
    expect(error.message).toContain("Session not active")
    expect(error.hint).toContain(LOGIN_HINT(PROFILE.online))
    expect(trace(result)).toEqual(["> POST <token>", "< 400"])
  })

  it("logs out: revokes the refresh token and removes the cache", async () => {
    const { cache } = await login(PROFILE.it)
    const logout = await run(authArgs("logout", PROFILE.it))
    expect(expectSuccess(logout).json<LogoutOutput>()).toEqual({
      profile: PROFILE.it,
      profiles: [PROFILE.it],
      tokenCache: cacheFile(PROFILE.it),
      removed: true,
      revoked: true,
    })
    expect(logout.stderr).toContain(
      `Note: the access token issued before stays valid until ${new Date(cache.expiresAt ?? 0).toISOString()} at gateways that check tokens offline.`,
    )
    expect(existsSync(cacheFile(PROFILE.it))).toBe(false)

    const refresh = await refreshRequest(top().issuer, CLIENTS.public, cache.refreshToken ?? "")
    expect(refresh).toMatchObject({
      status: 400,
      body: { error: "invalid_grant", error_description: "Offline user session not found" },
    })
    // Envoy checks JWTs offline: the issued access token works until it expires (documented)
    const stillValid = await fetch(`${top().url}/version`, {
      headers: { authorization: `Bearer ${cache.accessToken}` },
    })
    expect(stillValid.status).toBe(200)

    const after = await run(countArgs(PROFILE.it))
    expect(expectError(after, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(PROFILE.it))
    const again = await run(authArgs("logout", PROFILE.it))
    expect(expectSuccess(again).json<LogoutOutput>()).toMatchObject({
      removed: false,
      revoked: null,
    })
  })

  it("shares one login between profiles with the same settings, also names that differ in case", async () => {
    const { caseLower, caseUpper } = PROFILE
    const lower = await login(caseLower)
    expect(lower.view).toMatchObject({
      profile: caseLower,
      profiles: [caseLower, caseUpper],
      tokenCache: cacheFile(caseUpper),
    })
    expect(lower.result.stderr).toContain(
      `The login also serves another profile with the same issuer, client, audience and scopes:\n  ${caseUpper}  ${top().url}\n`,
    )
    expect(cacheFile(caseLower)).not.toBe(cacheFile(PROFILE.it))

    // the other profile uses the login and its refresh, and the first one the rotated token
    await writeCache(cacheFile(caseUpper), { expiresAt: Date.now() - 1_000 })
    const refreshed = await run(countArgs(caseUpper, globalFlag("verbose")))
    expect(expectSuccess(refreshed).json<Count>()).toEqual({ count: expect.any(Number) })
    expect(trace(refreshed)).toEqual(["> POST <token>", "< 200", COUNT_REQUEST, "< 200"])
    const rotated = await readCache(cacheFile(caseLower))
    expect(rotated.refreshToken).not.toBe(lower.cache.refreshToken)
    const reused = await run(countArgs(caseLower, globalFlag("verbose")))
    expect(trace(expectSuccess(reused))).toEqual([COUNT_REQUEST, "< 200"])

    // a logout of either ends it for both
    const logout = await run(authArgs("logout", caseUpper))
    expect(expectSuccess(logout).json<LogoutOutput>()).toMatchObject({
      profile: caseUpper,
      profiles: [caseLower, caseUpper],
      removed: true,
      revoked: true,
    })
    expect(logout.stderr).toContain(
      `Note: the login was shared; profile "${caseLower}" needs a new login, too.`,
    )
    const status = await run(authArgs("status", caseLower))
    expect(expectError(status, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(caseLower))
  })

  it("no longer reads a login that operate 0.7.0 cached under the file name of the profile", async () => {
    const { caseLower } = PROFILE
    await login(caseLower)
    const old = join(tokenDirectory(suite.workdir), `profile-${caseLower}.json`)
    await rename(cacheFile(caseLower), old)
    const status = await run(authArgs("status", caseLower))
    expect(expectError(status, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(caseLower))
    expect(await readdir(tokenDirectory(suite.workdir))).toContain(basename(old))
  })

  it("reports a token of the wrong audience as FORBIDDEN without refreshing", async () => {
    await login(PROFILE.noaud)
    const result = await run(countArgs(PROFILE.noaud, globalFlag("verbose")))
    const error = expectError(result, "FORBIDDEN", 4)
    expect(error.status).toBe(403)
    expect(error.message).toContain("Audiences in Jwt are not allowed")
    expect(error.hint).toContain("audience")
    expect(trace(result)).toEqual([COUNT_REQUEST, "< 403"])
  })

  it("reports a token of a differently spelled issuer as UNAUTHORIZED after one refresh", async (context) => {
    const { host, keycloakPort, url } = top()
    if (host !== "localhost") context.skip("the 127.0.0.1 spelling needs Docker on localhost")
    const loopbackIssuer = `http://127.0.0.1:${keycloakPort}/realms/operate`
    const { cache } = await login(PROFILE.loopbackIp)
    expect(claimsOf(cache.accessToken).iss).toBe(loopbackIssuer)

    const result = await run(countArgs(PROFILE.loopbackIp, globalFlag("verbose")))
    const error = expectError(result, "UNAUTHORIZED", 4)
    expect(error.status).toBe(401)
    expect(error.message).toContain("Jwt issuer is not configured")
    expect(error.hint).toContain("also after refreshing it")
    expect(error.hint).toContain("localhost and 127.0.0.1 are different issuers")
    expect(
      traceOf(result.stderr, { engine: url, token: endpointsOf(loopbackIssuer).token }),
    ).toEqual([COUNT_REQUEST, "< 401", "> POST <token>", "< 200", COUNT_REQUEST, "< 401"])
  })
}
