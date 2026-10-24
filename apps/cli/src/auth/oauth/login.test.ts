/**
 * The login flow on the fake runtime (loopback server, browser) and the fake identity provider.
 */

import { describe, expect, it } from "vitest"
import { fakeIdp, ISSUER } from "../../../test/support/fake-idp.js"
import { fakeRuntime, fileText } from "../../../test/support/fake-runtime.js"
import { loginDeps, oauthConfig, TOKEN_DIR, TOKEN_FILE } from "../../../test/support/oauth.js"
import {
  browserOf,
  printedUrl,
  rejection,
  run,
  setup,
  started,
  T0,
} from "../../../test/support/oauth-login.js"
import { IGNORED_STATE_NOTICE, login } from "./login.js"
import type { CachedLogin } from "./types.js"

describe("login", () => {
  it("logs in through the browser, writes the cache and prints the documented lines", async () => {
    const test = setup({}, { loopbackPort: 51_234 })
    const runtime = fakeRuntime({
      fetch: test.idp.fetch,
      now: () => T0,
      loopbackPort: 51_234,
      browser: browserOf(test.idp),
    })
    const result = await login(
      oauthConfig(),
      { noBrowser: false, loginTimeoutMs: 300_000 },
      loginDeps(runtime),
    )
    expect(result.tokenFile).toBe(TOKEN_FILE)
    expect(result.login).toEqual({
      version: 1,
      identity: {
        issuer: ISSUER,
        tokenEndpoint: null,
        clientId: "pulse-cli",
        audience: null,
        scopes: ["offline_access", "openid"],
      },
      endpoints: {
        token: `${ISSUER}/protocol/openid-connect/token`,
        revocation: `${ISSUER}/protocol/openid-connect/revoke`,
        clientAuthMethod: "none",
      },
      tokenType: "Bearer",
      accessToken: "access-2",
      expiresAt: T0 + 300_000,
      refreshToken: "refresh-2",
      refreshExpiresAt: T0 + 1_800_000,
      scope: "openid offline_access",
      subject: "user-1",
      user: "alice",
      loggedInAt: T0,
      refreshedAt: null,
    } satisfies CachedLogin)
    expect(JSON.parse(fileText(runtime, TOKEN_FILE) ?? "")).toEqual(result.login)
    expect(runtime.files.get(TOKEN_FILE)?.mode).toBe(0o600)
    expect(runtime.dirModes.get(TOKEN_DIR)).toBe(0o700)
    const url = runtime.browserUrls[0] ?? ""
    expect(runtime.stderr.text()).toBe(
      [
        `Logging in to ${ISSUER} as client pulse-cli (profile "p").`,
        "Open this URL in a browser to log in:",
        `  ${url}`,
        "Opened the system browser.",
        "Waiting up to 300 s for the login at http://127.0.0.1:51234/callback (Ctrl+C cancels).",
        'Logged in as alice (profile "p").',
        "",
      ].join("\n"),
    )
    expect(runtime.loopback).toMatchObject({ listens: [0], listening: false, closed: true })
    expect(runtime.randomRequests).toEqual([32, 32])
  })

  it("builds the authorization URL with the bound port, S256, scopes and audience", async () => {
    const test = setup({}, { loopbackPort: 40_000 })
    const { result, url, callback } = await started(test, { audience: "engine-rest" })
    const params = new URL(url).searchParams
    expect(Object.fromEntries(params)).toMatchObject({
      response_type: "code",
      client_id: "pulse-cli",
      redirect_uri: "http://127.0.0.1:40000/callback",
      scope: "openid offline_access",
      code_challenge_method: "S256",
      audience: "engine-rest",
    })
    expect(params.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(params.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(params.get("state")).not.toBe(params.get("code_challenge"))
    await test.runtime.loopback.request("/callback", callback)
    await expect(result).resolves.toBeDefined()
    expect(test.runtime.browserUrls).toEqual([])
  })

  it("listens on the configured redirect port", async () => {
    const test = setup()
    const { result, callback } = await started(test, { redirectPort: 8765 })
    expect(test.runtime.loopback.listens).toEqual([8765])
    expect(test.runtime.stderr.text()).toContain("for the login at http://127.0.0.1:8765/callback")
    await test.runtime.loopback.request("/callback", callback)
    await result
  })

  it("says when no browser could be opened", async () => {
    const test = setup({}, { browser: false })
    const result = run(test, {}, { noBrowser: false })
    result.catch(() => undefined)
    const url = await printedUrl(test.runtime)
    expect(test.runtime.browserUrls).toEqual([url])
    expect(test.runtime.stderr.text()).toContain(
      `  ${url}\nCould not open a browser; open the URL above yourself.\nWaiting up to`,
    )
    await test.runtime.loopback.request("/callback", test.idp.authorize(url))
    await result
  })

  it("keeps the query of explicit endpoints and needs no discovery", async () => {
    const idp = fakeIdp()
    const test = { idp, runtime: fakeRuntime({ fetch: idp.fetch, now: () => T0 }) }
    const endpoint = `${ISSUER}/protocol/openid-connect/auth`
    const { result, url, callback } = await started(test, {
      authorizationEndpoint: `${endpoint}?kc_idp_hint=corp`,
      tokenEndpoint: `${ISSUER}/protocol/openid-connect/token`,
    })
    expect(url.startsWith(`${endpoint}?kc_idp_hint=corp&response_type=code&`)).toBe(true)
    await test.runtime.loopback.request("/callback", callback)
    const done = await result
    expect(done.login.endpoints.revocation).toBeNull()
    expect(done.login.identity.tokenEndpoint).toBe(`${ISSUER}/protocol/openid-connect/token`)
    expect(test.idp.requests.some((request) => request.path.includes(".well-known"))).toBe(false)
    expect(test.runtime.stderr.text()).toContain(`Logging in to ${ISSUER} as client`)
  })

  it("names the origin of the authorization endpoint without an issuer", async () => {
    const test = setup()
    const { result, callback } = await started(test, {
      issuer: undefined,
      authorizationEndpoint: `${ISSUER}/protocol/openid-connect/auth`,
      tokenEndpoint: `${ISSUER}/protocol/openid-connect/token`,
      profile: undefined,
    })
    expect(test.runtime.stderr.text()).toContain(
      "Logging in to https://login.example.com as client pulse-cli (no profile).",
    )
    callback.delete("iss")
    await test.runtime.loopback.request("/callback", callback)
    expect((await result).tokenFile).toMatch(/\/env-[0-9a-f]{32}\.json$/)
  })

  it("answers other paths and methods without ending the login", async () => {
    const test = setup()
    const { result, callback } = await started(test)
    await expect(test.runtime.loopback.request("/favicon.ico")).resolves.toMatchObject({
      status: 404,
    })
    await expect(
      test.runtime.loopback.request("/callback", callback, "POST"),
    ).resolves.toMatchObject({ status: 405 })
    const success = await test.runtime.loopback.request("/callback", callback)
    expect(success.status).toBe(200)
    expect(success.html).toContain("Logged in")
    await result
  })

  it("refuses a second callback after the first was accepted", async () => {
    const test = setup()
    const done = { result: undefined as unknown }
    const runtime = fakeRuntime({
      fetch: test.idp.fetch,
      now: () => T0,
      browser: async (url, fake) => {
        const query = test.idp.authorize(url)
        const first = fake.loopback.request("/callback", query)
        done.result = await fake.loopback.request("/callback", query)
        await first
        return true
      },
    })
    await login(oauthConfig(), { noBrowser: false, loginTimeoutMs: 1000 }, loginDeps(runtime))
    expect(done.result).toMatchObject({ status: 409 })
    expect((done.result as { html: string }).html).toContain(
      "pulse-cli already received the login callback.",
    )
  })

  it("ignores callbacks without the right state and keeps waiting, with one notice", async () => {
    const test = setup()
    const { result, callback } = await started(test)
    const wrong = new URLSearchParams(callback)
    wrong.set("state", "not-the-state")
    for (const query of [
      wrong,
      new URLSearchParams({ code: "x" }),
      new URLSearchParams(`${callback.toString()}&state=${callback.get("state") ?? ""}`),
    ]) {
      const page = await test.runtime.loopback.request("/callback", query)
      expect(page.status).toBe(400)
      expect(page.html).toContain("This is not the callback of the running login.")
      expect(page.html).not.toContain(callback.get("code") ?? "never")
    }
    expect(test.runtime.stderr.text().split(IGNORED_STATE_NOTICE)).toHaveLength(2)
    expect(test.idp.tokenRequests()).toEqual([])
    expect(test.runtime.loopback.listening).toBe(true)
    expect((await test.runtime.loopback.request("/callback", callback)).status).toBe(200)
    await expect(result).resolves.toBeDefined()
    expect(test.idp.tokenRequests()).toHaveLength(1)
  })

  it("fails on an iss mismatch or a missing iss the server advertises", async () => {
    for (const change of [
      (query: URLSearchParams) => {
        query.set("iss", "https://evil.example.com")
      },
      (query: URLSearchParams) => {
        query.delete("iss")
      },
    ]) {
      const test = setup()
      const { result, callback } = await started(test)
      change(callback)
      const page = await test.runtime.loopback.request("/callback", callback)
      expect(page.status).toBe(400)
      expect(page.html).toContain("The login response came from another issuer.")
      const error = await rejection(result)
      expect(error.code).toBe("LOGIN_FAILED")
      expect(error.message).toBe(
        "The login response came from another issuer (possible mix-up attack)",
      )
      expect(test.idp.tokenRequests()).toEqual([])
      expect(test.runtime.loopback.closed).toBe(true)
    }
  })

  it("accepts a callback without iss when the server does not advertise it", async () => {
    const test = setup({ metadata: { authorization_response_iss_parameter_supported: undefined } })
    const { result, callback } = await started(test)
    callback.delete("iss")
    await test.runtime.loopback.request("/callback", callback)
    await expect(result).resolves.toBeDefined()
  })

  it.each([
    ["access_denied", "LOGIN_FAILED", "The login was denied (access_denied: cancelled)"],
    [
      "invalid_request",
      "CONFIG",
      "The authorization server refused the login request (invalid_request: cancelled)",
    ],
    [
      "temporarily_unavailable",
      "LOGIN_FAILED",
      "The login failed (temporarily_unavailable: cancelled)",
    ],
  ])("maps the callback error %s", async (code, errorCode, message) => {
    const test = setup()
    const { result, callback } = await started(test)
    callback.delete("code")
    callback.set("error", code)
    callback.set("error_description", "cancelled")
    const page = await test.runtime.loopback.request("/callback", callback)
    expect(page.html).toContain(`The authorization server reported ${code}.`)
    const error = await rejection(result)
    expect(error).toMatchObject({ code: errorCode, message })
  })
})
