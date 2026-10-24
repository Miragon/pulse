/**
 * The OAuth provider on the fake runtime and the fake identity provider: LOGIN_REQUIRED, Bearer
 * headers, reactive refresh, concurrent processes and dry-run previews. The proactive refresh
 * (rotation, the lock, fallbacks, the hints of rejected tokens) is in provider-refresh.test.ts.
 */

import { describe, expect, it } from "vitest"
import { oauthError } from "../../../test/support/fake-idp.js"
import { fakeRuntime } from "../../../test/support/fake-runtime.js"
import { rejection, setup, T0 } from "../../../test/support/oauth-provider.js"
import { cachedLogin, cacheText, TOKEN_FILE } from "../../../test/support/oauth.js"

const HINT =
  "Run `operate auth login --profile p` in a terminal: a person logs in once in the browser, operate refreshes the token afterwards. Agents cannot log in themselves."

describe("OAuth provider: the cached login", () => {
  it("sends the cached access token as the only header", async () => {
    const test = setup()
    await expect(test.provider().headers()).resolves.toEqual({
      Authorization: "Bearer cached-access",
    })
    expect(test.idp.requests).toEqual([])
  })

  it("reads the cache once per process", async () => {
    const test = setup()
    const auth = test.provider()
    await auth.headers()
    test.runtime.files.delete(TOKEN_FILE)
    await expect(auth.headers()).resolves.toEqual({ Authorization: "Bearer cached-access" })
  })

  it("fails with LOGIN_REQUIRED without a cache, with the exact hint", async () => {
    const error = await rejection(setup(null).provider().headers())
    expect(error).toMatchObject({
      code: "LOGIN_REQUIRED",
      message: 'Not logged in: profile "p" has no OAuth login',
    })
    expect(error.exitCode).toBe(4)
    expect(error.details.hint).toBe(
      `One login serves every OAuth profile of the same config file, project file or repository that stores the same issuer, client, audience and scopes. ${HINT}`,
    )
  })

  it("names where to log in in dry-run notes and the hint of a rejected token", async () => {
    const missing = await setup(null).provider({ projectDirectory: "/work/shop" }).preview?.()
    expect(missing?.note).toContain(
      "Run `operate auth login --profile p` in a terminal in /work/shop.",
    )
    const auth = setup().provider({ configFile: "/home/me/ci.json" })
    expect(auth.rejectedHint?.(401)).toContain(
      "run `operate auth login --config /home/me/ci.json --profile p` in a terminal.",
    )
  })

  it("names the directory of the project file to log in in", async () => {
    const error = await rejection(
      setup(null).provider({ projectDirectory: "/work/shop" }).headers(),
    )
    expect(error.details.hint).toContain(
      "Run `operate auth login --profile p` in a terminal in /work/shop: a person logs in once",
    )
  })

  it("fails with LOGIN_REQUIRED for a cache of another identity or an unknown format", async () => {
    const other = await rejection(setup().provider({ clientId: "other" }).headers())
    expect(other.message).toBe(
      'The OAuth login of profile "p" was made for another issuer, client, audience or scopes: client "operate-cli" (the configuration asks for "other")',
    )
    expect(other.details.hint).toBe(
      `The login was made with other settings: OPERATE_OAUTH_* variables were set where the login ran (also through another profile that shares the login). ${HINT}`,
    )
    const garbage = await rejection(setup('{"version":1}').provider().headers())
    expect(garbage.message).toBe(`The token cache ${TOKEN_FILE} has an unknown format`)
  })

  it("fails with LOGIN_REQUIRED for an expired token that cannot be refreshed", async () => {
    const noRefresh = setup(cachedLogin(T0, { refreshToken: null }))
    noRefresh.clock = T0 + 300_000
    expect((await rejection(noRefresh.provider().headers())).message).toBe(
      'The access token of profile "p" expired at 2023-11-14T22:18:20.000Z and there is no refresh token',
    )
    const expired = setup(cachedLogin(T0, { refreshExpiresAt: T0 + 100_000 }))
    expired.clock = T0 + 300_000
    expect((await rejection(expired.provider().headers())).message).toBe(
      'The OAuth login of profile "p" expired at 2023-11-14T22:15:00.000Z',
    )
    expect(noRefresh.idp.requests).toEqual([])
    expect(expired.idp.requests).toEqual([])
  })

  it("uses a token in its margin that cannot be refreshed until it expires", async () => {
    const test = setup(cachedLogin(T0, { refreshToken: null }))
    test.clock = T0 + 299_999
    await expect(test.provider().headers()).resolves.toEqual({
      Authorization: "Bearer cached-access",
    })
  })

  it("knows the user once the cache was read", async () => {
    const auth = setup().provider()
    expect(auth.principal).toBeUndefined()
    await auth.headers()
    expect(auth.principal).toEqual({ user: "alice", source: 'OAuth login of profile "p"' })
    const subjectOnly = setup(cachedLogin(T0, { user: null })).provider()
    await subjectOnly.headers()
    expect(subjectOnly.principal?.user).toBe("user-1")
    const anonymous = setup(cachedLogin(T0, { user: null, subject: null })).provider()
    await anonymous.headers()
    expect(anonymous.principal).toBeUndefined()
  })
})

describe("OAuth provider: concurrent processes", () => {
  it("adopts the token another process refreshed, without a token request", async () => {
    const test = setup()
    const [leader, follower] = [test.provider(), test.provider()]
    await follower.headers()
    test.clock = T0 + 250_000
    await expect(leader.headers()).resolves.toEqual({ Authorization: "Bearer access-1" })
    await expect(follower.headers()).resolves.toEqual({ Authorization: "Bearer access-1" })
    expect(test.idp.tokenRequests()).toHaveLength(1)
  })

  it("takes the refresh token from the file under the lock, never from memory", async () => {
    const test = setup()
    const auth = test.provider()
    await auth.headers()
    // another process rotated the refresh token; the access token in the file is the same
    test.idp.seed("rotated-refresh")
    test.runtime.files.set(TOKEN_FILE, {
      data: new TextEncoder().encode(
        cacheText(cachedLogin(T0, { refreshToken: "rotated-refresh" })),
      ),
      mode: 0o600,
    })
    test.clock = T0 + 250_000
    await auth.headers()
    const sent = test.idp.tokenRequests().map((request) => request.form.get("refresh_token"))
    expect(sent).toEqual(["rotated-refresh"])
  })

  it("refreshes with the file when its newer token already expired", async () => {
    const test = setup()
    const auth = test.provider()
    await auth.headers()
    test.idp.seed("newer-refresh")
    const newer = cachedLogin(T0, {
      accessToken: "newer-access",
      expiresAt: T0 + 100_000,
      refreshToken: "newer-refresh",
    })
    test.runtime.files.set(TOKEN_FILE, { data: new TextEncoder().encode(cacheText(newer)) })
    test.clock = T0 + 250_000
    await expect(auth.headers()).resolves.toEqual({ Authorization: "Bearer access-1" })
    expect(test.idp.tokenRequests().map((request) => request.form.get("refresh_token"))).toEqual([
      "newer-refresh",
    ])
  })

  it("fails with LOGIN_REQUIRED when the login was removed or replaced meanwhile", async () => {
    const removed = setup()
    const auth = removed.provider()
    await auth.headers()
    removed.runtime.files.delete(TOKEN_FILE)
    removed.clock = T0 + 250_000
    const error = await rejection(auth.headers())
    expect(error.message).toBe('The OAuth login of profile "p" was removed while this command ran')
    expect(removed.idp.requests).toEqual([])
    const replaced = setup()
    const other = replaced.provider()
    await other.headers()
    const foreign = cachedLogin(T0, { identity: { ...cachedLogin(T0).identity, clientId: "x" } })
    replaced.runtime.files.set(TOKEN_FILE, { data: new TextEncoder().encode(cacheText(foreign)) })
    replaced.clock = T0 + 250_000
    expect((await rejection(other.headers())).message).toBe(
      'The OAuth login of profile "p" was made for another issuer, client, audience or scopes: client "x" (the configuration asks for "operate-cli")',
    )
    expect(replaced.idp.requests).toEqual([])
  })

  it("fails with LOGIN_REQUIRED when the file has no usable refresh token", async () => {
    const test = setup()
    const auth = test.provider()
    await auth.headers()
    test.runtime.files.set(TOKEN_FILE, {
      data: new TextEncoder().encode(cacheText(cachedLogin(T0, { refreshToken: null }))),
    })
    test.clock = T0 + 250_000
    const error = await rejection(auth.headers())
    expect(error.message).toBe(
      'The access token of profile "p" expired at 2023-11-14T22:18:20.000Z and there is no refresh token',
    )
    expect(test.idp.requests).toEqual([])
  })
})

describe("OAuth provider: reactive refresh", () => {
  it("refreshes once per process after a 401", async () => {
    const test = setup()
    const auth = test.provider()
    await auth.headers()
    await expect(auth.refresh?.()).resolves.toBe(true)
    await expect(auth.headers()).resolves.toEqual({ Authorization: "Bearer access-1" })
    await expect(auth.refresh?.()).resolves.toBe(false)
    expect(test.idp.tokenRequests()).toHaveLength(1)
  })

  it("cannot refresh without a refresh token", async () => {
    const test = setup(cachedLogin(T0, { refreshToken: null }))
    await expect(test.provider().refresh?.()).resolves.toBe(false)
    expect(test.idp.requests).toEqual([])
  })

  it("propagates refresh errors instead of the 401", async () => {
    const test = setup()
    test.idp.queue("token", oauthError(400, "invalid_grant", "Session not active"))
    expect((await rejection(test.provider().refresh?.() ?? Promise.resolve())).code).toBe(
      "LOGIN_REQUIRED",
    )
  })

  it("names the rejected user and whether a refresh happened in the 401 hint", async () => {
    const test = setup()
    const auth = test.provider()
    await auth.headers()
    const first = auth.rejectedHint?.(401)
    expect(first).toBe(
      'The engine (or the gateway in front of it) rejected the OAuth access token of alice (profile "p"). The authorization server issued it, but it is not accepted here: the gateway must expect exactly the issuer operate logged in with (auth.issuer: https://login.example.com/realms/camunda; localhost and 127.0.0.1 are different issuers), and its clock must agree; `operate auth status --profile p` shows scopes and expiry. If the login was revoked, run `operate auth login --profile p` in a terminal.',
    )
    await auth.refresh?.()
    expect(auth.rejectedHint?.(401)).toContain(
      'of alice (profile "p"), also after refreshing it. The',
    )
  })

  it("explains a 403 with the audience and nothing for other statuses", () => {
    const auth = setup().provider({
      issuer: undefined,
      authorizationEndpoint: "https://as/a",
      tokenEndpoint: "https://as/t",
      profile: undefined,
    })
    expect(auth.rejectedHint?.(403)).toBe(
      'The gateway or the engine refused the OAuth access token of an unknown user (no profile). A JWT gateway answers 403 when the token\'s audience or scopes do not fit (e.g. "Audiences in Jwt are not allowed"): check the audience mapper or auth.audience and auth.scopes; otherwise the user lacks an engine authorization.',
    )
    expect(auth.rejectedHint?.(401)).toContain("(auth.issuer: not set;")
    expect(auth.rejectedHint?.(401)).toContain("`operate auth status` shows")
    expect(auth.rejectedHint?.(404)).toBeUndefined()
    expect(auth.rejectedHint?.(500)).toBeUndefined()
  })

  it("names the status command of its profile for the hint of a redirect", () => {
    expect(setup().provider().loginStatusCommand).toBe("operate auth status --profile p")
    expect(setup().provider({ profile: undefined }).loginStatusCommand).toBe("operate auth status")
  })
})

describe("OAuth provider: dry-run preview", () => {
  it("shows the cached token without a note while it is fresh", async () => {
    const test = setup()
    await expect(test.provider().preview?.()).resolves.toEqual({
      headers: { Authorization: "Bearer cached-access" },
    })
    expect(test.idp.requests).toEqual([])
    expect(test.runtime.locks).toEqual([])
  })

  it("notes a refresh it would do, or one it cannot do", async () => {
    const refresh = setup()
    refresh.clock = T0 + 250_000
    await expect(refresh.provider().preview?.()).resolves.toEqual({
      headers: { Authorization: "Bearer cached-access" },
      note: "The cached access token expires at 2023-11-14T22:18:20.000Z; operate would refresh it before sending.",
    })
    // an expiry in the past reads "expired", from the exact millisecond on
    const due = setup()
    due.clock = T0 + 300_000
    await expect(due.provider().preview?.()).resolves.toMatchObject({
      note: "The cached access token expired at 2023-11-14T22:18:20.000Z; operate would refresh it before sending.",
    })
    const expired = setup(cachedLogin(T0, { refreshToken: null }))
    expired.clock = T0 + 300_000
    await expect(expired.provider().preview?.()).resolves.toMatchObject({
      note: "The cached access token expired at 2023-11-14T22:18:20.000Z and operate cannot refresh it: the request would fail with LOGIN_REQUIRED. Run `operate auth login --profile p` in a terminal.",
    })
    const soon = setup(cachedLogin(T0, { refreshToken: null }))
    soon.clock = T0 + 250_000
    await expect(soon.provider().preview?.()).resolves.toMatchObject({
      note: "The cached access token expires at 2023-11-14T22:18:20.000Z and operate cannot refresh it.",
    })
    expect(refresh.idp.requests).toEqual([])
  })

  it("notes a missing login instead of failing", async () => {
    for (const test of [setup(null), setup("garbage")]) {
      await expect(test.provider().preview?.()).resolves.toEqual({
        headers: {},
        note: 'Not logged in with OAuth (profile "p"); the request would fail with LOGIN_REQUIRED. Run `operate auth login --profile p` in a terminal.',
      })
    }
    await expect(
      setup().provider({ clientId: "x", profile: undefined }).preview?.(),
    ).resolves.toMatchObject({
      note: "Not logged in with OAuth (no profile); the request would fail with LOGIN_REQUIRED. Run `operate auth login` in a terminal with OPERATE_AUTH=oauth and the same OPERATE_OAUTH_* settings.",
    })
  })

  it("propagates I/O errors of the cache", async () => {
    const test = setup(undefined, {
      deps: {
        fs: {
          ...fakeRuntime().fs,
          exists: () => Promise.reject(Object.assign(new Error("x"), { code: "EACCES" })),
        },
      },
    })
    expect((await rejection(test.provider().preview?.() ?? Promise.resolve())).code).toBe("CONFIG")
  })
})
