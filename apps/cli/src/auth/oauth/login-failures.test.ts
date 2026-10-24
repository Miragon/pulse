/** The ways a login fails, and what it records for confidential clients (login.ts). */

import { describe, expect, it } from "vitest"
import { oauthError } from "../../../test/support/fake-idp.js"
import { oauthConfig, TOKEN_FILE } from "../../../test/support/oauth.js"
import { rejection, run, setup, started } from "../../../test/support/oauth-login.js"

describe("login", () => {
  it("fails without a code", async () => {
    const test = setup()
    const { result, callback } = await started(test)
    callback.delete("code")
    await test.runtime.loopback.request("/callback", callback)
    expect((await rejection(result)).message).toBe(
      "The login callback carried no authorization code",
    )
  })

  it("fails when the code exchange is rejected, with a failure page", async () => {
    const test = setup()
    const { result, callback } = await started(test)
    test.idp.queue("token", oauthError(400, "invalid_grant", "Code not valid"))
    const page = await test.runtime.loopback.request("/callback", callback)
    expect(page.status).toBe(400)
    expect(page.html).toContain("operate could not exchange the authorization code.")
    const error = await rejection(result)
    expect(error.code).toBe("LOGIN_FAILED")
    expect(error.message).toBe(
      "The authorization server rejected the authorization code (invalid_grant: Code not valid)",
    )
    expect(test.runtime.files.has(TOKEN_FILE)).toBe(false)
  })

  it("sends the verifier whose challenge was in the URL (real S256 check)", async () => {
    const test = setup()
    const { result, url, callback } = await started(test)
    await test.runtime.loopback.request("/callback", callback)
    await result
    const exchange = test.idp.tokenRequests("authorization_code")[0]
    expect(exchange?.form.get("redirect_uri")).toBe(new URL(url).searchParams.get("redirect_uri"))
    expect(exchange?.form.get("code_verifier")).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it("gives up after the login timeout with the redirect URI hint, never the ephemeral port", async () => {
    const test = setup({}, { deadlineResolves: true, loopbackPort: 5555 })
    const error = await rejection(run(test, {}, { loginTimeoutMs: 1500 }))
    expect(error.code).toBe("LOGIN_FAILED")
    expect(error.message).toBe("No login arrived within 1.5 s")
    expect(error.details.hint).toBe(
      'Complete the login in the browser. If it showed an error such as "Invalid parameter: redirect_uri", register http://127.0.0.1/callback (any port; Keycloak, Entra ID) for client operate-cli, or set a fixed port (operate config set p --oauth-redirect-port <port>) and register http://127.0.0.1:<port>/callback; then run the command again.',
    )
    expect(test.runtime.deadlines).toEqual([1500])
    expect(test.runtime.stderr.text()).toContain("Waiting up to 1.5 s for the login")
    expect(test.runtime.loopback.closed).toBe(true)
  })

  it("names the fixed port, and the variable that sets it, in the timeout hint", async () => {
    const fixed = setup({}, { deadlineResolves: true, loopbackPort: 8765 })
    const error = await rejection(run(fixed, { redirectPort: 8765 }, { loginTimeoutMs: 1000 }))
    expect(error.details.hint).toContain(
      "register http://127.0.0.1/callback (any port; Keycloak, Entra ID) or http://127.0.0.1:8765/callback for client operate-cli; then",
    )
    const env = setup({}, { deadlineResolves: true })
    const sources = { ...oauthConfig().sources, redirectPort: "env" as const }
    const fromEnv = await rejection(run(env, { sources }, { loginTimeoutMs: 1000 }))
    expect(fromEnv.details.hint).toContain(
      "or set a fixed port (OPERATE_OAUTH_REDIRECT_PORT=<port>)",
    )
    const noProfile = setup({}, { deadlineResolves: true })
    const withoutProfile = await rejection(
      run(noProfile, { profile: undefined }, { loginTimeoutMs: 1000 }),
    )
    expect(withoutProfile.details.hint).toContain("(OPERATE_OAUTH_REDIRECT_PORT=<port>)")
  })

  it("reports a port in use and other listen errors as CONFIG", async () => {
    const busy = setup({}, { listenError: "EADDRINUSE" })
    const error = await rejection(run(busy, { redirectPort: 8765 }))
    expect(error.code).toBe("CONFIG")
    expect(error.message).toBe("Port 8765 for the login callback is in use")
    expect(error.details.hint).toBe(
      "Stop the program that uses it or choose another port: operate config set p --oauth-redirect-port <port> (0 = any free port); the port must match the redirect URI registered for client operate-cli.",
    )
    const sources = { ...oauthConfig().sources, redirectPort: "env" as const }
    const fromEnv = await rejection(
      run(setup({}, { listenError: "EADDRINUSE" }), { redirectPort: 8765, sources }),
    )
    expect(fromEnv.details.hint).toBe(
      "Stop the program that uses it or choose another port: OPERATE_OAUTH_REDIRECT_PORT=<port> (0 = any free port); the port must match the redirect URI registered for client operate-cli.",
    )
    const denied = setup({}, { listenError: "EACCES" })
    expect((await rejection(run(denied, { redirectPort: 80 }))).message).toBe(
      "Cannot listen on 127.0.0.1:80 for the login callback (EACCES)",
    )
  })

  it("warns when the server issued no refresh token", async () => {
    const test = setup({ refreshTokens: false, idToken: null })
    const { result, callback } = await started(test)
    await test.runtime.loopback.request("/callback", callback)
    const done = await result
    expect(done.login).toMatchObject({ refreshToken: null, refreshExpiresAt: null, user: null })
    expect(test.runtime.stderr.text()).toContain(
      'Warning: the authorization server issued no refresh token; commands fail with LOGIN_REQUIRED (exit 4) once the access token expires at 2023-11-14T22:18:20.000Z. Request the offline_access scope or allow refresh tokens for client operate-cli.\nLogged in as an unknown user (profile "p").\n',
    )
    const unknown = setup({ refreshTokens: false, expiresIn: null })
    const second = await started(unknown)
    await unknown.runtime.loopback.request("/callback", second.callback)
    await second.result
    expect(unknown.runtime.stderr.text()).toContain("once the access token expires. Request")
  })

  it("records client_secret_post for a confidential client that needs it", async () => {
    const test = setup({
      clients: { "operate-cli": { secret: "s3cret" } },
      metadata: { token_endpoint_auth_methods_supported: ["client_secret_post"] },
    })
    const { result, callback } = await started(test, { clientSecret: "s3cret" })
    await test.runtime.loopback.request("/callback", callback)
    const done = await result
    expect(done.login.endpoints.clientAuthMethod).toBe("client_secret_post")
    expect(test.idp.tokenRequests()[0]?.form.get("client_secret")).toBe("s3cret")
  })

  it("records client_secret_basic for a confidential client, none for a public one", async () => {
    const test = setup({ clients: { "operate-cli": { secret: "s3cret" } } })
    const { result, callback } = await started(test, { clientSecret: "s3cret" })
    await test.runtime.loopback.request("/callback", callback)
    expect((await result).login.endpoints.clientAuthMethod).toBe("client_secret_basic")
    const post = setup({
      metadata: { token_endpoint_auth_methods_supported: ["client_secret_post"] },
    })
    const second = await started(post)
    await post.runtime.loopback.request("/callback", second.callback)
    expect((await second.result).login.endpoints.clientAuthMethod).toBe("none")
  })

  it("closes the server when the handler throws for a callback", async () => {
    const test = setup()
    const { result, callback } = await started(test)
    test.idp.queue("token", new Error("socket hang up"))
    await test.runtime.loopback.request("/callback", callback)
    expect((await rejection(result)).code).toBe("NETWORK")
    expect(test.runtime.loopback.closed).toBe(true)
  })

  it("starts neither a server nor a browser when discovery fails", async () => {
    const test = setup()
    test.idp.queue("discovery", new Response("", { status: 404 }))
    test.idp.queue("discovery", new Response("", { status: 404 }))
    expect((await rejection(run(test))).code).toBe("CONFIG")
    expect(test.runtime.loopback.listens).toEqual([])
    expect(test.runtime.browserUrls).toEqual([])
  })
})
