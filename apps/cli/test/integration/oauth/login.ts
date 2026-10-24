/**
 * The first login of the OAuth suite: the gateway and the realm, a run before any login, the
 * login with auth code + PKCE and its cache, and the Bearer token on every request.
 */

import { existsSync } from "node:fs"
import { stat } from "node:fs/promises"
import { expect, it } from "vitest"
import { argv, globalFlag } from "../support/catalog.js"
import { ENGINES } from "../support/engines.js"
import { expectError, expectSuccess } from "../support/expect.js"
import { claimsOf } from "../support/jwt.js"
import { CLIENTS, directLogin, endpointsOf, refreshRequest, USER } from "../support/keycloak.js"
import { completeLogin, startLogin } from "../support/login.js"
import { readCache, tokenDirectory } from "../support/token-cache.js"
import { MASKED_BEARER, SENT_REQUEST, URL_LINE } from "../support/trace.js"
import type {
  ConfigShowOutput,
  Count,
  DryRunOutput,
  LoginOutput,
  PingOutput,
  ProcessDefinition,
} from "../support/types.js"
import {
  answers,
  AUDIENCE,
  authArgs,
  countArgs,
  DEFAULT_SCOPES,
  externalIpv4,
  headerValue,
  ISO_INSTANT,
  JWT,
  loginArgs,
  PROFILE,
  RUN_TIMEOUT_MS,
  type OAuthSuite,
} from "./suite.js"

export function registerLogin(suite: OAuthSuite): void {
  const { start, top, LOGIN_HINT, tokenEndpoint, cacheFile, trace, COUNT_REQUEST, run, login } =
    suite

  it("runs against a gateway that refuses bad tokens and a realm that rotates refresh tokens strictly", async () => {
    const { url, issuer } = top()
    const missing = await fetch(`${url}/version`)
    expect(missing.status).toBe(401)
    expect(await missing.text()).toBe("Jwt is missing")
    const garbage = await fetch(`${url}/version`, { headers: { authorization: "Bearer x.y.z" } })
    expect(garbage.status).toBe(401)

    // a login without the CLI, so this proves the environment, not the code under test
    const tokens = await directLogin(issuer, CLIENTS.public, DEFAULT_SCOPES.join(" "))
    const authorized = await fetch(`${url}/version`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(authorized.status).toBe(200)
    expect(await authorized.json()).toEqual({ version: ENGINES[top().engine].version })

    // an uncoordinated second use of a refresh token ends the session for everyone
    const first = await refreshRequest(issuer, CLIENTS.public, tokens.refreshToken)
    expect(first.status).toBe(200)
    const replay = await refreshRequest(issuer, CLIENTS.public, tokens.refreshToken)
    expect(replay).toMatchObject({
      status: 400,
      body: {
        error: "invalid_grant",
        error_description: "Maximum allowed refresh token reuse exceeded",
      },
    })
    const rotated = await refreshRequest(issuer, CLIENTS.public, String(first.body.refresh_token))
    expect(rotated).toMatchObject({ status: 400, body: { error: "invalid_grant" } })
  })

  it("fails with LOGIN_REQUIRED and never starts a login when nobody logged in", async () => {
    // a hanging login would hit this timeout instead of exiting
    const quick = { timeoutMs: 30_000 }
    const ping = await run(
      ["ping", globalFlag("profile"), PROFILE.it, globalFlag("verbose")],
      quick,
    )
    const error = expectError(ping, "LOGIN_REQUIRED", 4)
    expect(error.message).toBe('Not logged in: profile "it" has no OAuth login')
    expect(error.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(error.hint).toContain("in a terminal")
    expect(ping.stdout).toBe("")
    expect(ping.stderr).not.toMatch(SENT_REQUEST)
    expect(ping.stderr).not.toMatch(URL_LINE)

    const status = await run(authArgs("status", PROFILE.it), quick)
    expect(expectError(status, "LOGIN_REQUIRED", 4).hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(status.stdout).toBe("")

    const preview = await run(countArgs(PROFILE.it, globalFlag("dry-run")), quick)
    const request = expectSuccess(preview).json<DryRunOutput>()
    expect(headerValue(request.headers, "authorization")).toBeUndefined()
    expect(preview.stderr).toContain('Note: Not logged in with OAuth (profile "it")')
    expect(preview.stderr).toContain(LOGIN_HINT(PROFILE.it))
    expect(preview.stderr).not.toMatch(SENT_REQUEST)
    expect(existsSync(cacheFile(PROFILE.it))).toBe(false)
  })

  it("logs in with auth code + PKCE on a loopback port and caches the tokens with mode 0600", async () => {
    const { issuer } = top()
    const pending = startLogin(start, loginArgs(PROFILE.it), { timeoutMs: RUN_TIMEOUT_MS })
    const printedUrl = await pending.authorizationUrl()
    const printed = new URL(printedUrl)
    const { uri: redirectUri, port } = await pending.redirect()
    expect(`${printed.origin}${printed.pathname}`).toBe(endpointsOf(issuer).authorization)
    expect(Object.fromEntries(printed.searchParams)).toEqual({
      response_type: "code",
      client_id: CLIENTS.public,
      redirect_uri: redirectUri,
      scope: "openid offline_access",
      state: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge: expect.stringMatching(/^[\w-]{43}$/),
      code_challenge_method: "S256",
      audience: AUDIENCE,
    })
    expect(printed.searchParams.get("state")).not.toBe(printed.searchParams.get("code_challenge"))

    // the loopback server answers on 127.0.0.1 only, and only on GET /callback
    const probe = await fetch(`http://127.0.0.1:${port}/favicon.ico`)
    expect(probe.status).toBe(404)
    const post = await fetch(redirectUri, { method: "POST" })
    expect(post.status).toBe(405)
    const external = externalIpv4()
    if (external !== undefined) expect(await answers(`http://${external}:${port}/`)).toBe(false)

    const { browser, result } = await completeLogin(pending)
    suite.ledger.add(browser.callback.get("code"))
    expect(browser.callback.get("iss")).toBe(issuer)
    expect(browser.answer.status).toBe(200)
    expect(browser.answer.html).toContain("Logged in")
    await suite.ledger.expectHidden(result)
    expectSuccess(result)
    expect(result.stderr).toContain(
      `Logging in to ${issuer} as client ${CLIENTS.public} (profile "it").\n` +
        `Open this URL in a browser to log in:\n  ${printedUrl}\n`,
    )
    expect(result.stderr).toContain(
      `Waiting up to 300 s for the login at ${redirectUri} (Ctrl+C cancels).`,
    )
    expect(result.stderr).toContain('Logged in as operate-user (profile "it").')
    // --no-browser: neither browser line
    expect(result.stderr).not.toContain("Opened the system browser.")
    expect(result.stderr).not.toContain("Could not open a browser")
    expect(await answers(`http://127.0.0.1:${port}/`)).toBe(false)

    const view = result.json<LoginOutput>()
    expect(view).toEqual({
      profile: PROFILE.it,
      profiles: [PROFILE.it],
      issuer,
      clientId: CLIENTS.public,
      user: USER.username,
      subject: expect.stringMatching(/^[\w-]+$/),
      scopes: expect.arrayContaining(DEFAULT_SCOPES),
      accessTokenExpiresAt: expect.stringMatching(ISO_INSTANT),
      accessTokenValid: true,
      refreshTokenExpiresAt: expect.stringMatching(ISO_INSTANT),
      canRefresh: true,
      loggedInAt: expect.stringMatching(ISO_INSTANT),
      refreshedAt: null,
      tokenCache: cacheFile(PROFILE.it),
    })
    const loggedInAt = Date.parse(view.loggedInAt)
    const accessLifetime = Date.parse(view.accessTokenExpiresAt ?? "") - loggedInAt
    expect(accessLifetime).toBeGreaterThan(295_000)
    expect(accessLifetime).toBeLessThanOrEqual(300_000)
    // offline token: 30 days idle
    const refreshLifetime = Date.parse(view.refreshTokenExpiresAt ?? "") - loggedInAt
    expect(refreshLifetime).toBeGreaterThan(2_591_000_000)
    expect(refreshLifetime).toBeLessThanOrEqual(2_592_000_000)

    const cache = await readCache(cacheFile(PROFILE.it))
    expect(cache).toEqual({
      version: 1,
      identity: {
        issuer,
        tokenEndpoint: null,
        clientId: CLIENTS.public,
        audience: AUDIENCE,
        scopes: ["offline_access", "openid"],
      },
      endpoints: {
        token: tokenEndpoint(),
        revocation: endpointsOf(issuer).revocation,
        clientAuthMethod: "none",
      },
      tokenType: "Bearer",
      accessToken: expect.stringMatching(JWT),
      expiresAt: Date.parse(view.accessTokenExpiresAt ?? ""),
      refreshToken: expect.stringMatching(JWT),
      refreshExpiresAt: Date.parse(view.refreshTokenExpiresAt ?? ""),
      scope: expect.stringContaining("offline_access"),
      subject: view.subject,
      user: USER.username,
      loggedInAt,
      refreshedAt: null,
    })
    // the gateway accepts exactly this issuer and audience
    expect(claimsOf(cache.accessToken)).toMatchObject({
      iss: issuer,
      aud: expect.arrayContaining([AUDIENCE]),
      azp: CLIENTS.public,
    })
    if (process.platform !== "win32") {
      expect((await stat(cacheFile(PROFILE.it))).mode & 0o777).toBe(0o600)
      expect((await stat(tokenDirectory(suite.workdir))).mode & 0o777).toBe(0o700)
    }
  })

  it("sends the Bearer token on every request and never prints it unless --show-secrets", async () => {
    const { cache, view } = await login(PROFILE.it)
    const count = await run(countArgs(PROFILE.it, globalFlag("verbose")))
    expect(expectSuccess(count).json<Count>()).toEqual({ count: expect.any(Number) })
    // the fresh 300 s token is used as it is: no token request
    expect(trace(count)).toEqual([COUNT_REQUEST, "< 200"])
    expect(count.stderr).toMatch(MASKED_BEARER)

    const list = await run([...argv("process-definition list"), globalFlag("profile"), PROFILE.it])
    expect(expectSuccess(list).json<ProcessDefinition[]>()).toEqual(expect.any(Array))

    const ping = await run(["ping", globalFlag("profile"), PROFILE.it])
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
      url: top().url,
      reachable: true,
      auth: "oauth",
      user: USER.username,
    })

    const revealed = await run(
      countArgs(PROFILE.it, globalFlag("verbose"), globalFlag("show-secrets")),
    )
    expect(expectSuccess(revealed).stderr).toMatch(
      new RegExp(`^> authorization: Bearer ${cache.accessToken.replaceAll(".", "\\.")}$`, "im"),
    )
    // the ledger knows the cached tokens, so its checks of every other run are not vacuous
    await expect(suite.ledger.expectHidden(revealed)).rejects.toThrow(/stderr reveals a secret/)

    const preview = await run(countArgs(PROFILE.it, globalFlag("dry-run")))
    const request = expectSuccess(preview).json<DryRunOutput>()
    expect(headerValue(request.headers, "authorization")).toBe("Bearer ***")
    expect(request.curl).toMatch(/'authorization: Bearer \*\*\*'/i)
    expect(preview.stderr).not.toMatch(SENT_REQUEST)
    expect(preview.stderr).not.toContain("Note:")

    const show = await run(["config", "show", globalFlag("profile"), PROFILE.it])
    expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
      profile: PROFILE.it,
      values: {
        auth: { value: "oauth", source: "profile" },
        issuer: { value: top().issuer, source: "profile" },
        clientId: { value: CLIENTS.public, source: "profile" },
        audience: { value: AUDIENCE, source: "profile" },
      },
    })

    const status = await run(authArgs("status", PROFILE.it))
    expect(expectSuccess(status).json<LoginOutput>()).toEqual(view)
    const table = await run(authArgs("status", PROFILE.it, "-o", "table"))
    expect(expectSuccess(table).stdout).toMatch(
      new RegExp(`^subject\\s+${view.subject ?? "missing"}\\s*$`, "m"),
    )
    expect(table.stdout).toMatch(
      new RegExp(`^accessTokenExpiresAt\\s+${view.accessTokenExpiresAt ?? "missing"}\\s*$`, "m"),
    )
    // nothing above needed a refresh
    expect((await readCache(cacheFile(PROFILE.it))).accessToken).toBe(cache.accessToken)
  })
}
