/**
 * `operate auth login` through `run()` on the fake runtime and the fake identity provider: outputs
 * (json and table), stderr lines, exit codes and the token cache. `auth status|logout` are in
 * auth-logout.test.ts, profiles that share a login in auth-shared-login.test.ts.
 */

import { describe, expect, it } from "vitest"
import { errorOf, loginRuntime, type LoginSetup, T0 } from "../../../test/support/cli-auth.js"
import { connectionRefused } from "../../../test/support/fake-fetch.js"
import { ISSUER } from "../../../test/support/fake-idp.js"
import { CONFIG_PATH, execute, fakeRuntime } from "../../../test/support/fake-runtime.js"
import { TOKEN_DIR, TOKEN_FILE } from "../../../test/support/oauth.js"
import { run } from "../run.js"
import { parseLoginTimeout } from "./auth.js"

function setup(options: LoginSetup = {}) {
  const { idp, runtime } = loginRuntime(options)
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

describe("parseLoginTimeout", () => {
  it("defaults to five minutes", () => {
    expect(parseLoginTimeout(undefined)).toBe(300_000)
    expect(parseLoginTimeout(" 1000 ")).toBe(1000)
    expect(parseLoginTimeout("2147483647")).toBe(2_147_483_647)
  })
})
