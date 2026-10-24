/**
 * Logins that fail and other clients in the OAuth suite: wrong callbacks, timeouts, unknown
 * clients, a confidential client, an Authorization header, a login from the environment alone and
 * the browser.
 */

import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { join } from "node:path"
import { expect, it } from "vitest"
import { globalFlag } from "../support/catalog.js"
import { expectError, expectSuccess } from "../support/expect.js"
import {
  CLIENT_SECRET,
  CLIENTS,
  endpointsOf,
  openAuthorizationUrl,
  USER,
} from "../support/keycloak.js"
import { completeLogin, startLogin } from "../support/login.js"
import { envCacheFileName, readCache, tokenDirectory } from "../support/token-cache.js"
import { SENT_REQUEST, URL_LINE } from "../support/trace.js"
import type {
  ConfigShowOutput,
  Count,
  LoginOutput,
  LogoutOutput,
  PingOutput,
} from "../support/types.js"
import {
  authArgs,
  CLIENT_SECRET_ENV,
  countArgs,
  DEFAULT_SCOPES,
  eventually,
  IGNORED_STATE,
  listen,
  loginArgs,
  PROFILE,
  RUN_TIMEOUT_MS,
  UNKNOWN_CLIENT,
  type OAuthSuite,
} from "./suite.js"

export function registerFailures(suite: OAuthSuite): void {
  const { start, top, LOGIN_HINT, cacheFile, trace, run, login } = suite

  it("ignores callbacks without the right state and still completes the login", async () => {
    const pending = startLogin(start, loginArgs(PROFILE.it), { timeoutMs: RUN_TIMEOUT_MS })
    const forged = [
      { code: "forged-code-1" },
      { state: "wrong-state", code: "forged-code-2", iss: top().issuer },
      { state: "a", code: "forged-code-3" },
    ]
    for (const query of forged) {
      const answer = await fetch(await pending.callbackUrl(query))
      expect(answer.status).toBe(400)
      const html = await answer.text()
      expect(html).toContain("This is not the callback of the running login.")
      expect(html).not.toContain(query.code)
    }
    await pending.cli.waitForStderr(IGNORED_STATE)
    const { browser, result } = await completeLogin(pending)
    suite.ledger.add(browser.callback.get("code"))
    expect(browser.answer.status).toBe(200)
    expect(expectSuccess(result).stderr.match(IGNORED_STATE)).toHaveLength(1)
    expect(result.json<LoginOutput>()).toMatchObject({ profile: PROFILE.it, user: USER.username })
  })

  it("fails the login on an error callback and on a response from another issuer", async () => {
    const callbacks = [
      {
        query: { error: "access_denied", error_description: "The user cancelled" },
        message: "access_denied",
      },
      {
        query: { iss: "http://127.0.0.1:1/realms/evil", code: "forged-code-4" },
        message: "The login response came from another issuer (possible mix-up attack)",
      },
    ]
    for (const { query, message } of callbacks) {
      const pending = startLogin(start, loginArgs(PROFILE.it), { timeoutMs: RUN_TIMEOUT_MS })
      const state = new URL(await pending.authorizationUrl()).searchParams.get("state") ?? ""
      const answer = await fetch(await pending.callbackUrl({ state, iss: top().issuer, ...query }))
      expect(await answer.text()).toContain("Login failed")
      const error = expectError(await pending.result(), "LOGIN_FAILED", 4)
      expect(error.message).toContain(message)
    }
  })

  it("gives up waiting for the callback after --login-timeout and names the redirect URI", async () => {
    const started = Date.now()
    const pending = startLogin(start, loginArgs(PROFILE.it, "--login-timeout", "1000"), {
      timeoutMs: RUN_TIMEOUT_MS,
    })
    const result = await pending.result()
    const error = expectError(result, "LOGIN_FAILED", 4)
    expect(error.message).toContain("No login arrived within 1 s")
    expect(error.hint).toContain("http://127.0.0.1/callback")
    expect(error.hint).toContain(CLIENTS.public)
    expect(Date.now() - started).toBeLessThan(30_000)
  })

  it('shows Keycloak\'s "Client not found" for an unknown client id and names it on timeout', async () => {
    const pending = startLogin(start, loginArgs(PROFILE.it, "--login-timeout", "3000"), {
      timeoutMs: RUN_TIMEOUT_MS,
      env: { OPERATE_OAUTH_CLIENT_ID: UNKNOWN_CLIENT },
    })
    const url = await pending.authorizationUrl()
    expect(new URL(url).searchParams.get("client_id")).toBe(UNKNOWN_CLIENT)
    // the browser shows the error; the authorization server never redirects to operate
    const page = await openAuthorizationUrl(url)
    expect(page.status).toBe(400)
    expect(page.html).toContain("Client not found")
    const error = expectError(await pending.result(), "LOGIN_FAILED", 4)
    expect(error.message).toContain("No login arrived within 3 s")
    expect(error.hint).toContain(UNKNOWN_CLIENT)
  })

  it("names an unknown client at the token endpoint and a login made for another client", async () => {
    const { cache } = await login(PROFILE.it)
    // the login of a profile whose client id Keycloak does not know, due for a refresh
    const foreign = {
      ...cache,
      identity: { ...cache.identity, clientId: UNKNOWN_CLIENT },
      expiresAt: Date.now() - 1_000,
    }
    await writeFile(cacheFile(PROFILE.wrongClient), `${JSON.stringify(foreign, null, 2)}\n`, {
      mode: 0o600,
    })
    const rejected = await run(countArgs(PROFILE.wrongClient, globalFlag("verbose")))
    const error = expectError(rejected, "CONFIG", 3)
    expect(error.message).toContain(`The authorization server rejected client ${UNKNOWN_CLIENT}`)
    expect(error.message).toContain("invalid_client")
    expect(trace(rejected)).toEqual(["> POST <token>", "< 401"])

    const other = await run(countArgs(PROFILE.it, globalFlag("verbose")), {
      env: { OPERATE_OAUTH_CLIENT_ID: CLIENTS.short },
    })
    const mismatch = expectError(other, "LOGIN_REQUIRED", 4)
    expect(mismatch.message).toBe(
      `The OAuth login of profile "it" was made for another issuer, client, audience or scopes: client "${CLIENTS.public}" (the configuration asks for "${CLIENTS.short}")`,
    )
    expect(mismatch.hint).toContain(
      "OPERATE_OAUTH_CLIENT_ID of this environment makes the difference",
    )
    expect(mismatch.hint).toContain(LOGIN_HINT(PROFILE.it))
    expect(other.stderr).not.toMatch(SENT_REQUEST)
  })

  it("fails the login with CONFIG or NETWORK before waiting when it cannot start", async () => {
    // a login that wrongly starts waiting ends after 5 s instead of the 300 s default
    const BOUNDED = ["--login-timeout", "5000"]
    const blocker = createServer()
    const port = await listen(blocker)
    try {
      const busy = await run(loginArgs(PROFILE.it, ...BOUNDED), {
        env: { OPERATE_OAUTH_REDIRECT_PORT: String(port) },
      })
      const error = expectError(busy, "CONFIG", 3)
      expect(error.message).toContain(`Port ${port} for the login callback is in use`)
      // the variable overrides the profile, so the hint names the variable
      expect(error.hint).toContain("OPERATE_OAUTH_REDIRECT_PORT=<port>")
      expect(busy.stderr).not.toMatch(URL_LINE)
    } finally {
      blocker.close()
    }

    const unknownRealm = await run(loginArgs(PROFILE.it, ...BOUNDED), {
      env: { OPERATE_OAUTH_ISSUER: `${top().keycloakUrl}/realms/nope` },
    })
    expect(expectError(unknownRealm, "CONFIG", 3).message).toContain("OAuth discovery failed")
    expect(unknownRealm.stderr).not.toMatch(URL_LINE)

    const closed = await run(loginArgs(PROFILE.it, ...BOUNDED), {
      env: { OPERATE_OAUTH_ISSUER: "http://127.0.0.1:1/realms/operate" },
    })
    expect(expectError(closed, "NETWORK", 8).message).toContain(
      "Cannot reach the authorization server at http://127.0.0.1:1",
    )
  })

  it("authenticates a confidential client with client_secret_basic and masks the secret", async () => {
    const env = { [CLIENT_SECRET_ENV]: CLIENT_SECRET }
    const pending = startLogin(start, loginArgs(PROFILE.conf, globalFlag("verbose")), {
      timeoutMs: RUN_TIMEOUT_MS,
      env,
    })
    const { browser, result } = await completeLogin(pending)
    suite.ledger.add(browser.callback.get("code"))
    await suite.ledger.expectHidden(result)
    expectSuccess(result)
    expect(trace(result)).toEqual([
      "> GET <issuer>/.well-known/openid-configuration",
      "< 200",
      "> POST <token>",
      "< 200",
    ])
    expect(result.stderr).toMatch(/^> authorization: Basic \*\*\*$/im)

    const count = await run(countArgs(PROFILE.conf), { env })
    expect(expectSuccess(count).json<Count>()).toEqual({ count: expect.any(Number) })
    const show = await run(["config", "show", globalFlag("profile"), PROFILE.conf], { env })
    expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
      values: { clientId: { value: CLIENTS.confidential }, clientSecret: { value: "***" } },
    })
    expect((await readCache(cacheFile(PROFILE.conf))).endpoints.clientAuthMethod).toBe(
      "client_secret_basic",
    )
    // the login of the same issuer and client is revoked with its secret (Keycloak checks it)
    const logout = await run(authArgs("logout", PROFILE.conf, globalFlag("verbose")), { env })
    await suite.ledger.expectHidden(logout)
    expect(expectSuccess(logout).json<LogoutOutput>()).toMatchObject({
      removed: true,
      revoked: true,
    })
    expect(logout.stderr).toContain(`> POST ${endpointsOf(top().issuer).revocation}\n`)
    expect(logout.stderr).toMatch(/^> authorization: Basic \*\*\*$/im)

    const wrongSecret = "wrong-client-secret-it"
    suite.ledger.add(
      wrongSecret,
      Buffer.from(`${CLIENTS.confidential}:${wrongSecret}`, "utf8").toString("base64"),
    )
    const rejected = startLogin(start, loginArgs(PROFILE.conf), {
      timeoutMs: RUN_TIMEOUT_MS,
      env: { [CLIENT_SECRET_ENV]: wrongSecret },
    })
    const failed = await completeLogin(rejected)
    suite.ledger.add(failed.browser.callback.get("code"))
    await suite.ledger.expectHidden(failed.result)
    expect(failed.browser.answer.html).toContain("Login failed")
    expect(expectError(failed.result, "CONFIG", 3).message).toContain("unauthorized_client")
  })

  it("refuses OAuth together with an explicit Authorization header before any request", async () => {
    const result = await run([
      "ping",
      globalFlag("profile"),
      PROFILE.it,
      globalFlag("header"),
      "Authorization: x",
      globalFlag("verbose"),
    ])
    const error = expectError(result, "CONFIG", 3)
    expect(error.message).toContain("OAuth and an Authorization header are both configured")
    expect(result.stderr).not.toMatch(SENT_REQUEST)
  })

  it("logs in from OPERATE_OAUTH_* alone into a cache named after the identity", async () => {
    const { issuer, url } = top()
    const env = {
      OPERATE_AUTH: "oauth",
      OPERATE_OAUTH_ISSUER: issuer,
      OPERATE_OAUTH_CLIENT_ID: CLIENTS.public,
      OPERATE_URL: url,
    }
    const pending = startLogin(start, ["auth", "login", "--no-browser"], {
      timeoutMs: RUN_TIMEOUT_MS,
      env,
    })
    const { browser, result } = await completeLogin(pending)
    suite.ledger.add(browser.callback.get("code"))
    await suite.ledger.expectHidden(result)
    expect(expectSuccess(result).stderr).toContain(
      `Logging in to ${issuer} as client ${CLIENTS.public} (no profile).`,
    )
    const file = join(
      tokenDirectory(suite.workdir),
      envCacheFileName({
        issuer,
        tokenEndpoint: null,
        clientId: CLIENTS.public,
        audience: null,
        scopes: DEFAULT_SCOPES,
      }),
    )
    expect(result.json<LoginOutput>()).toMatchObject({
      profile: null,
      clientId: CLIENTS.public,
      user: USER.username,
      tokenCache: file,
    })
    expect(existsSync(file)).toBe(true)

    const ping = await run(["ping"], { env })
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
      url,
      auth: "oauth",
      user: USER.username,
    })
  })

  it.skipIf(process.platform === "win32")(
    "starts the browser named by BROWSER with the authorization URL",
    async () => {
      const record = join(suite.workdir, "browser-urls.txt")
      const browser = join(suite.workdir, "browser.cjs")
      const script = `require('node:fs').appendFileSync(${JSON.stringify(record)}, process.argv[2] + '\\n');\n`
      await writeFile(browser, `#!${process.execPath}\n${script}`, { mode: 0o755 })
      const pending = startLogin(start, ["auth", "login", "--profile", PROFILE.it], {
        timeoutMs: RUN_TIMEOUT_MS,
        env: { BROWSER: browser },
      })
      const url = await pending.authorizationUrl()
      await pending.cli.waitForStderr(/^Opened the system browser\.$/m)
      const recorded = await eventually(
        () => readFile(record, "utf8").catch(() => ""),
        (text) => text.endsWith("\n"),
      )
      expect(recorded).toBe(`${url}\n`)

      const { browser: page, result } = await completeLogin(pending)
      suite.ledger.add(page.callback.get("code"))
      await suite.ledger.expectHidden(result)
      expect(expectSuccess(result).json<LoginOutput>()).toMatchObject({ user: USER.username })
    },
  )
}
