/**
 * Bearer tokens end to end through `run()`, part 2: `auth status` and `auth login|logout` with a
 * bearer token (src/cli/bearer.test.ts has the sources, the wire and the hints).
 */

import { describe, expect, it } from "vitest"
import { jwtWith, NOW_S, VALID_CLAIMS } from "../../test/support/bearer.js"
import { errorOf, profiles, server } from "../../test/support/cli-bearer.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
  fileText,
} from "../../test/support/fake-runtime.js"
import { cachedLogin, cacheText, oauthProfiles, TOKEN_FILE } from "../../test/support/oauth.js"
import { run } from "./run.js"

const JWT = jwtWith(VALID_CLAIMS)
const EXPIRED = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 31 })

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}, status = 200) {
  const fake = server(status)
  const outcome = await execute(run, args, fakeRuntime({ fetch: fake.fetch, ...options }))
  return { ...outcome, requests: fake.requests }
}

describe("operate auth with a bearer token", () => {
  it("shows the source and the claims of a JWT without the token", async () => {
    const result = await cli(["auth", "status"], { env: { OPERATE_TOKEN: JWT } })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      type: "bearer",
      profile: null,
      source: "env",
      origin: "OPERATE_TOKEN",
      command: null,
      cached: false,
      format: "jwt",
      subject: VALID_CLAIMS.sub,
      user: "alice",
      issuer: VALID_CLAIMS.iss,
      audience: ["engine-rest", "account"],
      expiresAt: "2023-11-14T23:13:20.000Z",
      expired: false,
    })
    expect(result.stdout + result.stderr).not.toContain(JWT)
    expect(result.requests).toEqual([])
  })

  it("shows a piped token", async () => {
    const result = await cli(["auth", "status", "--auth-token-stdin"], { stdin: `${JWT}\n` })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      source: "flag",
      origin: "--auth-token-stdin",
    })
    const oauth = {
      [CONFIG_PATH]: profiles({
        p: { auth: { type: "oauth", issuer: "https://login.example.com/realms/x", clientId: "c" } },
      }),
    }
    const refused = await cli(["auth", "status", "--auth-token-stdin"], {
      stdin: "t",
      files: oauth,
    })
    expect(errorOf(refused.stderr)).toMatchObject({
      message:
        '--auth-token-stdin reads a bearer token, but OAuth is selected by the auth.type of profile "p"',
      // auth commands have no --auth option: the hint names the variable
      hint: "Drop --auth-token-stdin, or select bearer auth with OPERATE_AUTH=bearer.",
    })
    const followed = await cli(["auth", "status", "--auth-token-stdin"], {
      stdin: `${JWT}\n`,
      files: oauth,
      env: { OPERATE_AUTH: "bearer" },
    })
    expect(followed.code).toBe(0)
    expect(JSON.parse(followed.stdout)).toMatchObject({
      source: "flag",
      subject: VALID_CLAIMS.sub,
    })
    // a Basic profile: the error is about the piped token, not "needs OAuth"
    const basic = {
      [CONFIG_PATH]: profiles({ p: { auth: { type: "basic", username: "u", passwordEnv: "PW" } } }),
    }
    const piped = await cli(["auth", "status", "--auth-token-stdin"], { stdin: "t", files: basic })
    expect(errorOf(piped.stderr).message).toBe(
      '--auth-token-stdin reads a bearer token, but Basic auth is selected by the auth.type of profile "p"',
    )
  })

  it("shows an opaque token of a profile as a table", async () => {
    const files = { [CONFIG_PATH]: profiles({ p: { auth: { type: "bearer", token: "op" } } }) }
    const result = await cli(["auth", "status", "-o", "table"], { files })
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('origin     auth.token of profile "p"')
    expect(result.stdout).toMatch(/format +opaque/)
    expect(result.stdout).toMatch(/expired +false/)
  })

  it("prints the view of an expired JWT and exits with TOKEN_EXPIRED", async () => {
    const result = await cli(["auth", "status"], { env: { OPERATE_TOKEN: EXPIRED } })
    expect(result.code).toBe(4)
    expect(JSON.parse(result.stdout)).toMatchObject({
      expired: true,
      expiresAt: "2023-11-14T22:12:49.000Z",
    })
    expect(errorOf(result.stderr).code).toBe("TOKEN_EXPIRED")
  })

  it("refuses auth login and auth logout: operate manages no bearer token", async () => {
    const login = await cli(["auth", "login"], { env: { OPERATE_TOKEN: "t" } })
    expect(login.code).toBe(2)
    expect(errorOf(login.stderr)).toMatchObject({
      code: "USAGE",
      message: "operate auth login does not apply to bearer tokens",
    })
    expect(errorOf(login.stderr).hint).toContain("never logs in, refreshes or stores it")
    const files = {
      [CONFIG_PATH]: profiles({ p: { auth: { type: "bearer", tokenEnv: "UNSET" } } }),
    }
    const unresolved = await cli(["auth", "login"], { files })
    expect(errorOf(unresolved.stderr).message).toBe(
      "operate auth login does not apply to bearer tokens",
    )
    const logout = await cli(["auth", "logout"], { files })
    expect(logout.code).toBe(2)
    expect(errorOf(logout.stderr)).toMatchObject({
      message: "operate auth logout does not apply to bearer tokens",
      hint: 'operate stores no bearer token, so there is nothing to log out (bearer auth is selected by the auth.type of profile "p"); `operate config unset p auth` removes that setting. The token stays valid at the engine until it expires; revoke it with the tool that issued it.',
    })
    const env = await cli(["auth", "logout"], { env: { OPERATE_TOKEN: "t" } })
    expect(errorOf(env.stderr).hint).toBe(
      "operate stores no bearer token, so there is nothing to log out (bearer auth is selected by a token from OPERATE_TOKEN without an auth type); unset OPERATE_TOKEN to stop sending it. The token stays valid at the engine until it expires; revoke it with the tool that issued it.",
    )
    for (const result of [login, unresolved, logout, env])
      expect(result.runtime.browserUrls).toEqual([])
  })

  it("names OPERATE_AUTH=bearer, not the OAuth profile, as what blocks login and logout", async () => {
    const files = {
      [CONFIG_PATH]: profiles({
        sso: {
          auth: { type: "oauth", issuer: "https://login.example.com/realms/x", clientId: "c" },
        },
        plain: {},
      }),
    }
    const env = { OPERATE_AUTH: "bearer" }
    const login = await cli(["auth", "login", "--profile", "sso"], { files, env })
    expect(errorOf(login.stderr).hint).toMatch(/^Bearer auth is selected by OPERATE_AUTH=bearer: /)
    expect(errorOf(login.stderr).hint).toContain(
      'To log in with OAuth instead, unset OPERATE_AUTH so that the auth settings of profile "sso" apply.',
    )
    const logout = await cli(["auth", "logout", "--profile", "sso"], { files, env })
    expect(errorOf(logout.stderr).hint).toBe(
      'operate stores no bearer token, so there is nothing to log out (bearer auth is selected by OPERATE_AUTH=bearer); unset OPERATE_AUTH to use the auth settings of profile "sso". The token stays valid at the engine until it expires; revoke it with the tool that issued it.',
    )
    // a token without a type and a profile without auth: nothing to unset in the profile
    const token = { OPERATE_TOKEN: "t" }
    const plain = await cli(["auth", "logout", "--profile", "plain"], { files, env: token })
    expect(errorOf(plain.stderr).hint).toContain("unset OPERATE_TOKEN to stop sending it")
    expect(errorOf(plain.stderr).hint).not.toContain("config unset")
    const inferred = await cli(["auth", "login", "--profile", "plain"], { files, env: token })
    expect(errorOf(inferred.stderr).hint).toContain(
      "For an OAuth login run by operate: unset OPERATE_TOKEN and configure OAuth: operate config set plain --auth oauth",
    )
    const anonymous = await cli(["auth", "login"], { env: { ...env, ...token } })
    expect(errorOf(anonymous.stderr).hint).toContain("the auth settings of the configuration apply")
  })

  it("removes the OAuth login when config set switches the profile to a bearer token", async () => {
    const files = { [CONFIG_PATH]: oauthProfiles(), [TOKEN_FILE]: cacheText(cachedLogin(0)) }
    const args = ["config", "set", "p", "--auth", "bearer", "--auth-token-env", "CI_TOKEN"]
    const result = await cli(args, { files, env: { CI_TOKEN: "t" } })
    expect(result.code).toBe(0)
    expect(result.stderr).toContain(
      `Removed the OAuth login of profile "p" for its previous settings (${TOKEN_FILE}); it was not revoked.\n`,
    )
    expect(fileText(result.runtime, TOKEN_FILE)).toBeUndefined()
  })

  it("says that auth status needs OAuth or a bearer token, and how to use one that is set", async () => {
    const result = await cli(["auth", "status"], {
      env: { OPERATE_USERNAME: "demo", OPERATE_PASSWORD: "x" },
    })
    expect(errorOf(result.stderr).message).toBe(
      "operate auth status needs OAuth or a bearer token, but the configuration uses basic",
    )
    const files = {
      [CONFIG_PATH]: profiles({
        b2: { auth: { type: "basic", username: "demo", passwordEnv: "CI_PW" } },
        nn: { auth: { type: "none" } },
        offp: { auth: { type: "none", tokenEnv: "CI_T" } },
      }),
    }
    const status = async (profile: string, env: Record<string, string>) =>
      errorOf((await cli(["auth", "status", "--profile", profile], { files, env })).stderr)
    expect(await status("b2", { CI_PW: "x", OPERATE_TOKEN: "abc" })).toEqual({
      code: "CONFIG",
      exitCode: 3,
      message: 'operate auth status needs OAuth or a bearer token, but profile "b2" uses basic',
      hint: 'A bearer token is set (from OPERATE_TOKEN) but not used: Basic auth is selected by the auth.type of profile "b2"; use it with OPERATE_AUTH=bearer.',
    })
    // the password variable is not set: still about the token, not about the password
    expect((await status("b2", { OPERATE_TOKEN: "abc" })).hint).toBe(
      'A bearer token is set (from OPERATE_TOKEN) but not used: Basic auth is selected by the auth.type of profile "b2"; use it with OPERATE_AUTH=bearer.',
    )
    expect((await status("nn", { OPERATE_TOKEN: "abc" })).hint).toBe(
      'A bearer token is set (from OPERATE_TOKEN) but not used: bearer auth is switched off by the auth.type of profile "nn"; use it with OPERATE_AUTH=bearer.',
    )
    expect((await status("offp", { CI_T: "abc" })).hint).toBe(
      'Bearer auth is switched off by the auth.type of profile "offp". Switch it on: operate config set offp --auth bearer',
    )
    expect((await status("offp", { CI_T: "abc", OPERATE_AUTH: "none" })).hint).toBe(
      "Bearer auth is switched off by OPERATE_AUTH=none. Switch it on: OPERATE_AUTH=bearer",
    )
    // following the hints works
    const followed = await cli(["auth", "status", "--profile", "b2"], {
      files,
      env: { CI_PW: "x", OPERATE_TOKEN: "abc", OPERATE_AUTH: "bearer" },
    })
    expect(followed.code).toBe(0)
    expect(JSON.parse(followed.stdout)).toMatchObject({ type: "bearer", origin: "OPERATE_TOKEN" })
  })
})
