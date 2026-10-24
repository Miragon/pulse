/**
 * `operate auth login|status|logout` through `run()` on the fake runtime and the fake identity
 * provider: outputs (json and table), stderr lines, exit codes and the token cache.
 */

import { describe, expect, it } from "vitest"
import { connectionRefused } from "../../../test/support/fake-fetch.js"
import { fakeIdp, type FakeIdpOptions, ISSUER } from "../../../test/support/fake-idp.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../../test/support/fake-runtime.js"
import {
  cachedLogin,
  cacheText,
  loginFile,
  loginKey,
  oauthProfiles,
  REVOCATION_ENDPOINT,
  TOKEN_DIR,
  TOKEN_FILE,
} from "../../../test/support/oauth.js"
import { run } from "../run.js"
import { parseLoginTimeout } from "./auth.js"

const T0 = 1_700_000_000_000

/** The login of a confidential client (client_secret_basic). */
const CONFIDENTIAL_LOGIN = cachedLogin(T0, {
  endpoints: {
    token: `${ISSUER}/protocol/openid-connect/token`,
    revocation: REVOCATION_ENDPOINT,
    clientAuthMethod: "client_secret_basic",
  },
})

function errorOf(stderr: string): Record<string, unknown> {
  const line = stderr.trim().split("\n").at(-1) ?? ""
  return (JSON.parse(line) as { error: Record<string, unknown> }).error
}

function setup(
  options: {
    idp?: FakeIdpOptions
    runtime?: FakeRuntimeOptions
    files?: Record<string, string>
  } = {},
) {
  const idp = fakeIdp(options.idp)
  const browser = async (url: string, runtime: FakeRuntime) => {
    await runtime.loopback.request("/callback", idp.authorize(url))
    return true
  }
  const runtime = fakeRuntime({
    fetch: idp.fetch,
    now: () => T0,
    browser,
    files: { [CONFIG_PATH]: oauthProfiles(), ...options.files },
    ...options.runtime,
  })
  return { idp, runtime, cli: (args: readonly string[]) => execute(run, args, runtime) }
}

describe("operate auth login", () => {
  it("logs in, prints the view as JSON and the documented lines on stderr", async () => {
    const { cli, runtime } = setup()
    const result = await cli(["auth", "login"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      profile: "p",
      profiles: ["p"],
      issuer: ISSUER,
      clientId: "operate-cli",
      user: "alice",
      subject: "user-1",
      scopes: ["openid", "offline_access"],
      accessTokenExpiresAt: "2023-11-14T22:18:20.000Z",
      accessTokenValid: true,
      refreshTokenExpiresAt: "2023-11-14T22:43:20.000Z",
      canRefresh: true,
      loggedInAt: "2023-11-14T22:13:20.000Z",
      refreshedAt: null,
      tokenCache: TOKEN_FILE,
    })
    expect(result.stderr).toMatch(
      /^Logging in to https:\/\/login\.example\.com\/realms\/camunda as client operate-cli \(profile "p"\)\.\nOpen this URL in a browser to log in:\n {2}https:\/\/\S+\nOpened the system browser\.\nWaiting up to 300 s for the login at http:\/\/127\.0\.0\.1:53682\/callback \(Ctrl\+C cancels\)\.\nLogged in as alice \(profile "p"\)\.\n$/,
    )
    expect(runtime.files.get(TOKEN_FILE)?.mode).toBe(0o600)
    expect(runtime.dirModes.get(TOKEN_DIR)).toBe(0o700)
  })

  it("prints KEY VALUE rows with -o table", async () => {
    const { cli } = setup()
    const result = await cli(["auth", "login", "-o", "table"])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain("scopes                 openid offline_access")
    expect(result.stdout).toMatch(/refreshedAt\s*\n/)
    expect(result.stdout).toMatch(/^KEY\s+VALUE/)
  })

  it("only prints the URL with --no-browser and accepts --login-timeout", async () => {
    const { cli, runtime, idp } = setup({ runtime: { browser: false } })
    const pending = cli(["auth", "login", "--no-browser", "--login-timeout", "600000"])
    for (let attempt = 0; attempt < 100 && !runtime.stderr.text().includes("Waiting"); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const url = /^ {2}(\S+)$/m.exec(runtime.stderr.text())?.[1] ?? ""
    expect(runtime.stderr.text()).toContain("Waiting up to 600 s")
    await runtime.loopback.request("/callback", idp.authorize(url))
    expect((await pending).code).toBe(0)
    expect(runtime.browserUrls).toEqual([])
    expect(runtime.stderr.text()).not.toContain("browser.")
  })

  it("traces the discovery and token requests with --verbose", async () => {
    const { cli } = setup()
    const result = await cli(["auth", "login", "--verbose"])
    expect(result.stderr).toContain(`> GET ${ISSUER}/.well-known/openid-configuration\n`)
    expect(result.stderr).toContain(`> POST ${ISSUER}/protocol/openid-connect/token\n`)
    expect(result.stderr).toMatch(/< 200 OK \(\d+ ms, \d+ bytes\)/)
  })

  it.each(["0", "-1", "soon", "2147483648"])("refuses --login-timeout %s", async (value) => {
    const { cli, runtime } = setup()
    const result = await cli(["auth", "login", "--login-timeout", value])
    expect(result.code).toBe(2)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "USAGE",
      message: `--login-timeout expects a positive number of milliseconds, got "${value}"`,
    })
    expect(runtime.loopback.listens).toEqual([])
  })

  it("needs OAuth", async () => {
    const { cli } = setup({
      files: {
        [CONFIG_PATH]: JSON.stringify({
          defaultProfile: "p",
          profiles: { p: { auth: { type: "basic", username: "u", password: "p" } } },
        }),
      },
    })
    const result = await cli(["auth", "login"])
    expect(result.code).toBe(3)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "CONFIG",
      message: 'operate auth login needs OAuth, but profile "p" uses basic',
      hint: "Configure it: operate config set p --auth oauth --oauth-issuer <url> --oauth-client-id <id>",
    })
    const none = await execute(run, ["auth", "status"], fakeRuntime())
    expect(errorOf(none.stderr)).toMatchObject({
      message: "operate auth status needs OAuth or a bearer token, but the configuration uses none",
      hint: "Configure it: operate config set <profile> --auth oauth --oauth-issuer <url> --oauth-client-id <id>. For a bearer token from elsewhere: OPERATE_AUTH=bearer with OPERATE_TOKEN or --auth-token-stdin.",
    })
  })

  it("says what switched stored or exported OAuth settings off", async () => {
    const oauthKeys = { issuer: "https://login.example.com/realms/x", clientId: "cli" }
    const files = (type: string) => ({
      [CONFIG_PATH]: JSON.stringify({
        defaultProfile: "p",
        profiles: { p: { auth: { type, ...oauthKeys } } },
      }),
    })
    const hintOf = async (args: string[], options: Parameters<typeof fakeRuntime>[0]) =>
      errorOf((await execute(run, args, fakeRuntime(options))).stderr).hint

    expect(await hintOf(["auth", "login"], { files: files("none") })).toBe(
      'OAuth is switched off by the auth.type of profile "p". Switch it on: operate config set p --auth oauth',
    )
    expect(
      await hintOf(["auth", "status"], { files: files("oauth"), env: { OPERATE_AUTH: "none" } }),
    ).toBe("OAuth is switched off by OPERATE_AUTH=none. Switch it on: OPERATE_AUTH=oauth")
    expect(await hintOf(["auth", "login"], { env: { OPERATE_OAUTH_CLIENT_ID: "cli" } })).toBe(
      "OAuth settings are set (from OPERATE_OAUTH_CLIENT_ID), but no auth type selects OAuth. Switch it on: OPERATE_AUTH=oauth",
    )
    // a switched-off Basic auth is no OAuth setting: the usual way to configure OAuth
    expect(await hintOf(["auth", "login"], { env: { OPERATE_PASSWORD: "pw" } })).toBe(
      "Configure it: operate config set <profile> --auth oauth --oauth-issuer <url> --oauth-client-id <id>",
    )
  })

  it("hints only at what the auth commands accept: following a hint is never a USAGE error", async () => {
    const env = { OPERATE_OAUTH_CLIENT_ID: "operate-cli", OPERATE_OAUTH_ISSUER: ISSUER }
    for (const command of ["login", "status"]) {
      const first = await execute(run, ["auth", command], fakeRuntime({ env }))
      const hint = String(errorOf(first.stderr).hint)
      expect(hint).not.toContain("--auth")
      expect(hint).toMatch(/Switch it on: OPERATE_AUTH=oauth$/)
      // the hint followed: the variable, not an option
      const followed = await execute(
        run,
        ["auth", command],
        fakeRuntime({ env: { ...env, OPERATE_AUTH: "oauth" } }),
      )
      expect(errorOf(followed.stderr).code).not.toBe("USAGE")
      const unknown = await execute(run, ["auth", command, "--auth", "oauth"], fakeRuntime({ env }))
      expect(errorOf(unknown.stderr).code).toBe("USAGE")
    }
  })

  it("asks only to remove an Authorization header, never to switch OAuth off", async () => {
    for (const command of ["login", "status"]) {
      const { cli } = setup({ runtime: { env: { OPERATE_HEADERS: "Authorization: Bearer x" } } })
      const result = await cli(["auth", command])
      expect(result.code).toBe(3)
      expect(errorOf(result.stderr)).toMatchObject({
        code: "CONFIG",
        message: "OAuth and an Authorization header are both configured",
        hint: "Remove the Authorization header (from OPERATE_HEADERS): with OAuth, operate sends the access token in it.",
      })
    }
    const { cli } = setup({ runtime: { env: { OPERATE_HEADERS: "Authorization: Bearer x" } } })
    const ping = await cli(["ping"])
    expect(errorOf(ping.stderr).hint).toContain("switch OAuth off with --auth none")
  })

  it("reports a Basic profile as such, without asking for its password", async () => {
    const basic = (auth: object) => ({
      [CONFIG_PATH]: JSON.stringify({ defaultProfile: "p", profiles: { p: { auth } } }),
    })
    for (const auth of [
      { type: "basic", username: "demo", passwordEnv: "PW" },
      { username: "demo", passwordEnv: "PW" },
    ]) {
      for (const command of ["login", "status"]) {
        const result = await execute(run, ["auth", command], fakeRuntime({ files: basic(auth) }))
        expect(result.code).toBe(3)
        const needs = command === "status" ? "OAuth or a bearer token" : "OAuth"
        const bearer =
          command === "status"
            ? ". For a bearer token from elsewhere: OPERATE_AUTH=bearer with OPERATE_TOKEN or --auth-token-stdin."
            : ""
        expect(errorOf(result.stderr)).toMatchObject({
          code: "CONFIG",
          message: `operate auth ${command} needs ${needs}, but profile "p" uses basic`,
          hint: `Configure it: operate config set p --auth oauth --oauth-issuer <url> --oauth-client-id <id>${bearer}`,
        })
      }
    }
    // other resolution errors stay as they are
    const oauth = await execute(
      run,
      ["auth", "login"],
      fakeRuntime({ files: basic({ type: "oauth", clientId: "x", clientSecretEnv: "MISSING" }) }),
    )
    expect(errorOf(oauth.stderr).message).toBe("OAuth is selected but the issuer is missing")
    const missing = await execute(run, ["auth", "status", "--profile", "nope"], fakeRuntime())
    expect(errorOf(missing.stderr).message).toBe('Profile "nope" does not exist')
  })

  it("reports a login timeout as LOGIN_FAILED with exit 4", async () => {
    const { cli } = setup({ runtime: { browser: false, deadlineResolves: true } })
    const result = await cli(["auth", "login", "--login-timeout", "1000"])
    expect(result.code).toBe(4)
    expect(errorOf(result.stderr)).toMatchObject({
      code: "LOGIN_FAILED",
      message: "No login arrived within 1 s",
    })
    expect(result.stdout).toBe("")
  })

  it("reports an unreachable authorization server as NETWORK with exit 8", async () => {
    const { cli, idp } = setup()
    idp.queue("discovery", connectionRefused())
    const result = await cli(["auth", "login"])
    expect(result.code).toBe(8)
  })

  it("logs in with the environment only, into an env-<hash> file", async () => {
    const { runtime, idp } = setup({ files: {} })
    runtime.files.delete(CONFIG_PATH)
    const env = {
      OPERATE_AUTH: "oauth",
      OPERATE_OAUTH_ISSUER: ISSUER,
      OPERATE_OAUTH_CLIENT_ID: "operate-cli",
    }
    const envRuntime = fakeRuntime({
      fetch: idp.fetch,
      now: () => T0,
      env,
      browser: async (url, fake) => {
        await fake.loopback.request("/callback", idp.authorize(url))
        return true
      },
    })
    const result = await execute(run, ["auth", "login"], envRuntime)
    expect(result.code).toBe(0)
    expect(result.stderr).toContain("(no profile)")
    const view = JSON.parse(result.stdout) as { tokenCache: string; profile: null }
    expect(view.profile).toBeNull()
    expect(view.tokenCache).toMatch(
      /^\/home\/tester\/\.config\/operate\/tokens\/env-[0-9a-f]{32}\.json$/,
    )
    const status = await execute(run, ["auth", "status"], envRuntime)
    expect(status.code).toBe(0)
    envRuntime.stdout.chunks.length = 0
    const logout = await execute(run, ["auth", "logout"], envRuntime)
    expect(JSON.parse(logout.stdout)).toEqual({
      profile: null,
      profiles: [],
      tokenCache: view.tokenCache,
      removed: true,
      revoked: true,
    })
  })
})

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

describe("profiles that share a login", () => {
  /** Profiles of the same issuer and client: one login for all, whatever their names. */
  const profiles = (names: readonly string[]) =>
    JSON.stringify({
      profiles: Object.fromEntries(
        names.map((name, index) => [
          name,
          {
            url: `http://localhost:${String(8112 + index)}/engine-rest`,
            auth: { type: "oauth", issuer: ISSUER, clientId: "operate-cli" },
          },
        ]),
      ),
    })

  it("log in once for every profile of the file, also those that differ only in case", async () => {
    const { cli, runtime } = setup({
      files: { [CONFIG_PATH]: profiles(["orders", "billing", "ORDERS"]) },
    })
    const login = await cli(["auth", "login", "--profile", "billing"])
    expect(login.code).toBe(0)
    expect(login.stderr).toContain(
      'Logged in as alice (profile "billing").\nThe login also serves 2 other profiles with the same issuer, client, audience and scopes:\n  orders  http://localhost:8112/engine-rest\n  ORDERS  http://localhost:8114/engine-rest\n',
    )
    expect(JSON.parse(login.stdout)).toMatchObject({
      profile: "billing",
      profiles: ["orders", "billing", "ORDERS"],
      tokenCache: TOKEN_FILE,
    })
    expect([...runtime.files.keys()].filter((path) => path.startsWith(TOKEN_DIR))).toEqual([
      TOKEN_FILE,
    ])
    runtime.stdout.chunks.length = 0
    const status = await cli(["auth", "status", "--profile", "ORDERS"])
    expect(status.code).toBe(0)
    expect(JSON.parse(status.stdout)).toMatchObject({
      profile: "ORDERS",
      profiles: ["orders", "billing", "ORDERS"],
      user: "alice",
    })
  })

  it("say on login that a single other profile shares it", async () => {
    const { cli } = setup({ files: { [CONFIG_PATH]: profiles(["orders", "billing"]) } })
    const login = await cli(["auth", "login", "--profile", "orders"])
    expect(login.stderr).toContain(
      "The login also serves another profile with the same issuer, client, audience and scopes:\n  billing  http://localhost:8113/engine-rest\n",
    )
  })

  it("lose the login together on auth logout of one of them", async () => {
    const { cli, idp, runtime } = setup({
      files: {
        [CONFIG_PATH]: profiles(["orders", "billing", "invoices"]),
        [TOKEN_FILE]: cacheText(cachedLogin(T0)),
      },
    })
    const result = await cli(["auth", "logout", "--profile", "billing"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      profile: "billing",
      profiles: ["orders", "billing", "invoices"],
      tokenCache: TOKEN_FILE,
      removed: true,
      revoked: true,
    })
    expect(result.stderr).toContain(
      'Note: the login was shared; profiles "orders" and "invoices" need a new login, too.\n',
    )
    expect(idp.revoked).toEqual(["cached-refresh"])
    expect(runtime.files.has(TOKEN_FILE)).toBe(false)
  })

  it("keep the login on config delete of one of them, until the last one goes", async () => {
    const { cli, runtime } = setup({
      files: {
        [CONFIG_PATH]: profiles(["orders", "billing"]),
        [TOKEN_FILE]: cacheText(cachedLogin(T0)),
      },
    })
    const first = await cli(["config", "delete", "orders"])
    expect(first.stderr).toBe(`Deleted profile "orders" from ${CONFIG_PATH}\n`)
    expect(runtime.files.has(TOKEN_FILE)).toBe(true)
    runtime.stderr.chunks.length = 0
    const last = await cli(["config", "delete", "billing"])
    expect(last.stderr).toBe(
      `Deleted profile "billing" from ${CONFIG_PATH}\nRemoved the OAuth login of profile "billing" (${TOKEN_FILE}); it was not revoked.\n`,
    )
    expect(runtime.files.has(TOKEN_FILE)).toBe(false)
  })

  it("get a login of their own with another audience or scopes", async () => {
    const { cli } = setup({
      files: {
        [CONFIG_PATH]: profiles(["orders", "billing"]),
        [TOKEN_FILE]: cacheText(cachedLogin(T0)),
      },
    })
    for (const change of ["--oauth-audience=engine-rest", "--oauth-scopes=openid"]) {
      expect((await cli(["config", "set", "billing", change])).code).toBe(0)
      const status = await cli(["auth", "status", "--profile", "billing"])
      expect(errorOf(status.stderr)).toMatchObject({
        code: "LOGIN_REQUIRED",
        message: 'Not logged in: profile "billing" has no OAuth login',
      })
      const orders = await cli(["auth", "status", "--profile", "orders"])
      expect(orders.code).toBe(0)
    }
  })

  it("revoke and remove the logins operate 0.7.0 and earlier cached under the name on auth logout", async () => {
    const files = {
      [CONFIG_PATH]: JSON.stringify({
        defaultProfile: "Prod",
        profiles: { Prod: { auth: { type: "oauth", issuer: ISSUER, clientId: "operate-cli" } } },
      }),
      [`${TOKEN_DIR}/profile-%50rod.json`]: cacheText(cachedLogin(T0, { refreshToken: "r-07" })),
      [`${TOKEN_DIR}/profile-Prod.json`]: cacheText(cachedLogin(T0, { refreshToken: "r-05" })),
    }
    const { cli, idp, runtime } = setup({ files })
    const result = await cli(["auth", "logout"])
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      profile: "Prod",
      removed: false,
      oldTokenCaches: [`${TOKEN_DIR}/profile-%50rod.json`, `${TOKEN_DIR}/profile-Prod.json`],
    })
    expect(result.stderr).toContain(
      `Logged out the login that operate 0.7.0 or earlier cached for profile "Prod" (${TOKEN_DIR}/profile-%50rod.json).\n`,
    )
    expect(result.stderr).toContain(`(${TOKEN_DIR}/profile-Prod.json).\n`)
    expect(idp.revoked).toEqual(["r-07", "r-05"])
    expect([...runtime.files.keys()].filter((path) => path.startsWith(TOKEN_DIR))).toEqual([])
  })

  it("never take the old login of a profile whose name differs only in case (macOS, Windows)", async () => {
    const auth = { type: "oauth", issuer: ISSUER, clientId: "operate-cli" }
    const files = {
      [CONFIG_PATH]: JSON.stringify({ profiles: { Prod: { auth }, prod: { auth } } }),
      [`${TOKEN_DIR}/profile-%50rod.json`]: cacheText(cachedLogin(T0, { refreshToken: "r-Prod" })),
      [`${TOKEN_DIR}/profile-prod.json`]: cacheText(cachedLogin(T0, { refreshToken: "r-prod" })),
    }
    const { cli, idp, runtime } = setup({ files, runtime: { caseInsensitive: true } })
    const result = await cli(["auth", "logout", "--profile", "Prod"])
    expect(JSON.parse(result.stdout)).toMatchObject({
      oldTokenCaches: [`${TOKEN_DIR}/profile-%50rod.json`],
    })
    expect(idp.revoked).toEqual(["r-Prod"])
    expect(runtime.files.has(`${TOKEN_DIR}/profile-prod.json`)).toBe(true)
    // config delete removes the old file of the deleted name (not revoked), as 0.7.0 did
    const deleted = await cli(["config", "delete", "prod"])
    expect(deleted.stderr).toContain(
      `Removed the login that operate 0.7.0 or earlier cached for profile "prod" (${TOKEN_DIR}/profile-prod.json); it was not revoked.\n`,
    )
    expect(runtime.files.has(`${TOKEN_DIR}/profile-prod.json`)).toBe(false)
    expect(idp.revoked).toEqual(["r-Prod"])
  })

  it("never let a profile without stored OAuth settings reach the login of another one", async () => {
    // "env" stores only its type: issuer and client come from OPERATE_OAUTH_*; "plain" is Basic
    const env = {
      OPERATE_OAUTH_ISSUER: ISSUER,
      OPERATE_OAUTH_CLIENT_ID: "operate-cli",
      OPERATE_PASSWORD: "pw",
    }
    const config = JSON.stringify({
      profiles: {
        env: { auth: { type: "oauth" } },
        plain: { auth: { type: "basic", username: "u" } },
      },
    })
    const envLogin = loginFile(loginKey({ issuer: null, clientId: null }))
    const { cli, idp, runtime } = setup({
      runtime: { env },
      files: { [CONFIG_PATH]: config, [envLogin]: cacheText(cachedLogin(T0)) },
    })
    expect((await cli(["auth", "status", "--profile", "env"])).code).toBe(0)
    runtime.stdout.chunks.length = 0
    const plain = await cli(["auth", "logout", "--profile", "plain"])
    expect(plain.code).toBe(0)
    expect(JSON.parse(plain.stdout)).toMatchObject({ profile: "plain", removed: false })
    expect(idp.revoked).toEqual([])
    expect(runtime.files.has(envLogin)).toBe(true)
    // with OPERATE_AUTH=oauth the Basic profile gets a login of its own, never that of "env"
    const oauth = setup({
      runtime: { env: { ...env, OPERATE_AUTH: "oauth" } },
      files: { [CONFIG_PATH]: config, [envLogin]: cacheText(cachedLogin(T0)) },
    })
    const own = await oauth.cli(["auth", "status", "--profile", "plain"])
    expect(errorOf(own.stderr)).toMatchObject({ code: "LOGIN_REQUIRED" })
    expect((await oauth.cli(["auth", "status", "--profile", "env"])).code).toBe(0)
    // its own login goes with it on config delete
    const plainLogin = loginFile(loginKey({ profile: "plain", issuer: null, clientId: null }))
    oauth.runtime.files.set(plainLogin, { data: new TextEncoder().encode("{}") })
    const deleted = await oauth.cli(["config", "delete", "plain"])
    expect(deleted.stderr).toContain(
      `Removed the OAuth login of profile "plain" (${plainLogin}); it was not revoked.\n`,
    )
    expect(oauth.runtime.files.has(envLogin)).toBe(true)
  })

  it("never read the profile-<name>.json logins of operate 0.7.0 and earlier", async () => {
    const old = `${TOKEN_DIR}/profile-p.json`
    const { cli, runtime } = setup({ files: { [old]: cacheText(cachedLogin(T0)) } })
    const status = await cli(["auth", "status"])
    expect(errorOf(status.stderr)).toMatchObject({ code: "LOGIN_REQUIRED" })
    expect(runtime.files.has(old)).toBe(true)
  })
})

describe("parseLoginTimeout", () => {
  it("defaults to five minutes", () => {
    expect(parseLoginTimeout(undefined)).toBe(300_000)
    expect(parseLoginTimeout(" 1000 ")).toBe(1000)
    expect(parseLoginTimeout("2147483647")).toBe(2_147_483_647)
  })
})
