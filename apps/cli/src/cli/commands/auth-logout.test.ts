/**
 * `operate auth status|logout` through `run()` on the fake runtime and the fake identity provider:
 * outputs, stderr lines, exit codes and the token cache (auth.test.ts has `auth login`).
 */

import { describe, expect, it } from "vitest"
import { errorOf, loginRuntime, type LoginSetup, T0 } from "../../../test/support/cli-auth.js"
import { ISSUER } from "../../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime, fileText } from "../../../test/support/fake-runtime.js"
import {
  cachedLogin,
  cacheText,
  oauthProfiles,
  REVOCATION_ENDPOINT,
  TOKEN_FILE,
} from "../../../test/support/oauth.js"
import { run } from "../run.js"

/** The login of a confidential client (client_secret_basic). */
const CONFIDENTIAL_LOGIN = cachedLogin(T0, {
  endpoints: {
    token: `${ISSUER}/protocol/openid-connect/token`,
    revocation: REVOCATION_ENDPOINT,
    clientAuthMethod: "client_secret_basic",
  },
})

function setup(options: LoginSetup = {}) {
  const { idp, runtime } = loginRuntime(options)
  return { idp, runtime, cli: (args: readonly string[]) => execute(run, args, runtime) }
}

describe("operate auth status", () => {
  it("prints the cached login without network access", async () => {
    const { cli, idp, runtime } = setup({
      files: { [TOKEN_FILE]: cacheText(cachedLogin(T0 - 1000)) },
    })
    const result = await cli(["auth", "status"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      profile: "p",
      user: "alice",
      accessTokenValid: true,
      canRefresh: true,
      tokenCache: TOKEN_FILE,
    })
    expect(idp.requests).toEqual([])
    expect(runtime.locks).toEqual([])
    expect(result.stdout).not.toContain("cached-access")
    expect(result.stdout).not.toContain("cached-refresh")
  })

  it("exits 0 for an expired access token that can be refreshed", async () => {
    const { cli } = setup({ files: { [TOKEN_FILE]: cacheText(cachedLogin(T0 - 400_000)) } })
    const result = await cli(["auth", "status", "-o", "table"])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/accessTokenValid\s+false/)
  })

  it.each([
    [null, 'Not logged in: profile "p" has no OAuth login'],
    [
      cacheText(cachedLogin(T0, { identity: { ...cachedLogin(T0).identity, clientId: "x" } })),
      'The OAuth login of profile "p" was made for another issuer, client, audience or scopes: client "x" (the configuration asks for "operate-cli")',
    ],
    [
      cacheText(cachedLogin(T0 - 400_000, { refreshToken: null })),
      'The access token of profile "p" expired at 2023-11-14T22:11:40.000Z and there is no refresh token',
    ],
    ["{", `The token cache ${TOKEN_FILE} has an unknown format`],
  ])(
    "fails with LOGIN_REQUIRED and an empty stdout when no command could run",
    async (content, message) => {
      const { cli } = setup({ files: content === null ? {} : { [TOKEN_FILE]: content } })
      const result = await cli(["auth", "status"])
      expect(result.code).toBe(4)
      expect(result.stdout).toBe("")
      expect(errorOf(result.stderr)).toMatchObject({
        code: "LOGIN_REQUIRED",
        message,
        hint: expect.stringContaining(
          "Run `operate auth login --profile p` in a terminal",
        ) as string,
      })
    },
  )
})

describe("operate auth logout", () => {
  it("revokes, removes the file and notes the still valid access token", async () => {
    const { cli, idp, runtime } = setup({ files: { [TOKEN_FILE]: cacheText(cachedLogin(T0)) } })
    const result = await cli(["auth", "logout"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      profile: "p",
      profiles: ["p"],
      tokenCache: TOKEN_FILE,
      removed: true,
      revoked: true,
    })
    expect(result.stderr).toBe(
      "Note: the access token issued before stays valid until 2023-11-14T22:18:20.000Z at gateways that check tokens offline.\n",
    )
    expect(runtime.files.has(TOKEN_FILE)).toBe(false)
    expect(idp.revoked).toEqual(["cached-refresh"])
    expect(idp.requests[0]?.url).toBe(REVOCATION_ENDPOINT)
  })

  it("reports nothing to do when not logged in", async () => {
    const { cli } = setup()
    const result = await cli(["auth", "logout", "-o", "table"])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/removed\s+false/)
    expect(result.stdout).toMatch(/revoked\s*\n/)
    expect(result.stderr).toBe("")
  })

  it("warns about a failed revocation and still removes the file", async () => {
    const { cli, idp, runtime } = setup({
      files: { [TOKEN_FILE]: cacheText(cachedLogin(T0 - 400_000)) },
    })
    idp.queue("revocation", new Response("", { status: 503 }))
    const result = await cli(["auth", "logout"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ removed: true, revoked: false })
    expect(result.stderr).toBe(
      `Warning: could not revoke the refresh token at ${REVOCATION_ENDPOINT} (HTTP 503 Service Unavailable); it stays valid until it expires.\n`,
    )
    expect(runtime.files.has(TOKEN_FILE)).toBe(false)
  })

  it("works for a profile whose OAuth settings no longer resolve", async () => {
    for (const { auth, env } of [
      { auth: { clientSecretEnv: "UNSET_SECRET" }, env: {} },
      { auth: {}, env: { OPERATE_OAUTH_REDIRECT_PORT: "any" } },
    ]) {
      const { cli, idp, runtime } = setup({
        runtime: { env },
        files: { [CONFIG_PATH]: oauthProfiles(auth), [TOKEN_FILE]: cacheText(cachedLogin(T0)) },
      })
      const result = await cli(["auth", "logout", "--verbose"])
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ removed: true, revoked: true })
      expect(result.stderr).toContain(`> POST ${REVOCATION_ENDPOINT}\n`)
      expect(idp.revoked).toEqual(["cached-refresh"])
      expect(runtime.files.has(TOKEN_FILE)).toBe(false)
    }
  })

  it("skips the revocation with a warning when the client secret does not resolve", async () => {
    const { cli, idp } = setup({
      files: {
        [CONFIG_PATH]: oauthProfiles({ clientSecretEnv: "MISSING_SECRET" }),
        [TOKEN_FILE]: cacheText(CONFIDENTIAL_LOGIN),
      },
    })
    const result = await cli(["auth", "logout"])
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(
      'Warning: the client secret of the login is not available (the OAuth settings of profile "p" do not resolve: The client secret variable MISSING_SECRET (auth.clientSecretEnv of profile "p") is not set or empty); the refresh token was not revoked and stays valid until it expires.\n',
    )
    expect(idp.requests).toEqual([])
  })

  it("revokes a confidential login with the secret of the same issuer and client", async () => {
    const { cli, idp } = setup({
      idp: { clients: { "operate-cli": { secret: "a-secret" } } },
      runtime: { env: { A_SECRET: "a-secret" } },
      files: {
        [CONFIG_PATH]: oauthProfiles({ clientSecretEnv: "A_SECRET" }),
        [TOKEN_FILE]: cacheText(CONFIDENTIAL_LOGIN),
      },
    })
    const result = await cli(["auth", "logout"])
    expect(JSON.parse(result.stdout)).toMatchObject({ removed: true, revoked: true })
    expect(idp.requests[0]?.headers.authorization).toBe(`Basic ${btoa("operate-cli:a-secret")}`)
  })

  it("never sends the secret of other settings to the authorization server of the login", async () => {
    const secret = { OPERATE_OAUTH_CLIENT_SECRET: "secret-of-b" }
    const cases = [
      // the environment points at another issuer and client with their own secret
      {
        ...secret,
        OPERATE_OAUTH_ISSUER: "https://b.example.com/realms/b",
        OPERATE_OAUTH_CLIENT_ID: "b-client",
      },
      // the environment switches to Basic auth; an exported secret of another setup
      { ...secret, OPERATE_AUTH: "basic", OPERATE_USERNAME: "u", OPERATE_PASSWORD: "pw" },
    ]
    for (const env of cases) {
      const { cli, idp, runtime } = setup({
        idp: { clients: { "operate-cli": { secret: "a-secret" } } },
        runtime: { env },
        files: { [CONFIG_PATH]: oauthProfiles(), [TOKEN_FILE]: cacheText(CONFIDENTIAL_LOGIN) },
      })
      const result = await cli(["auth", "logout"])
      expect(result.code).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ removed: true, revoked: false })
      expect(result.stderr).toContain("Warning: the client secret of the login is not available (")
      expect(idp.requests).toEqual([])
      expect(runtime.files.has(TOKEN_FILE)).toBe(false)
    }
  })

  it("warns that a login without a revocation endpoint stays valid", async () => {
    const login = cachedLogin(T0, {
      endpoints: { token: `${ISSUER}/token`, revocation: null, clientAuthMethod: "none" },
    })
    const { cli } = setup({ files: { [TOKEN_FILE]: cacheText(login) } })
    const result = await cli(["auth", "logout", "-o", "table"])
    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/removed\s+true/)
    expect(result.stderr).toBe(
      `Warning: operate knows no token revocation endpoint (RFC 7009) for ${ISSUER} (explicit endpoints, or none in its discovery document); the refresh token was not revoked and stays valid until 2023-11-14T22:43:20.000Z. End the session at the authorization server if needed (sign out, or revoke the user's sessions).\nNote: the access token issued before stays valid until 2023-11-14T22:18:20.000Z at gateways that check tokens offline.\n`,
    )
  })

  it("needs a resolvable OAuth configuration without a profile", async () => {
    const plain = await execute(run, ["auth", "logout"], fakeRuntime())
    expect(plain.code).toBe(3)
    expect(errorOf(plain.stderr).message).toBe(
      "operate auth logout needs OAuth, but the configuration uses none",
    )
    const broken = await execute(
      run,
      ["auth", "logout"],
      fakeRuntime({ env: { OPERATE_AUTH: "oauth" } }),
    )
    expect(errorOf(broken.stderr).message).toBe(
      "OAuth is selected but the issuer and the client id are missing",
    )
    const missing = await execute(run, ["auth", "logout", "--profile", "nope"], fakeRuntime())
    expect(errorOf(missing.stderr).message).toBe('Profile "nope" does not exist')
  })

  it("uses --timeout when the settings do not resolve", async () => {
    const { cli, runtime } = setup({
      files: {
        [CONFIG_PATH]: oauthProfiles({ clientSecretEnv: "UNSET_SECRET" }),
        [TOKEN_FILE]: cacheText(cachedLogin(T0)),
      },
    })
    expect((await cli(["auth", "logout", "--timeout", "5000"])).code).toBe(0)
    expect(runtime.locks[0]?.holdMs).toBe(15_000)
    const bad = await cli(["auth", "logout", "--timeout", "x"])
    expect(bad.code).toBe(3)
  })

  it("removes the login so that commands need a new one", async () => {
    const { cli, runtime } = setup({ files: { [TOKEN_FILE]: cacheText(cachedLogin(T0)) } })
    await cli(["auth", "logout"])
    runtime.stdout.chunks.length = 0
    runtime.stderr.chunks.length = 0
    const second = await cli(["auth", "logout"])
    expect(JSON.parse(second.stdout)).toEqual({
      profile: "p",
      profiles: ["p"],
      tokenCache: TOKEN_FILE,
      removed: false,
      revoked: null,
    })
    expect(fileText(runtime, TOKEN_FILE)).toBeUndefined()
  })
})
