/**
 * `pulse-cli auth` and `config delete` for profiles that share a login (the same issuer and client):
 * one login for all of them, lost together on logout and kept until the last of them goes, a login
 * of its own for another audience or scopes, and the logins operate 0.7.0 and earlier cached under
 * the profile name.
 */

import { describe, expect, it } from "vitest"
import { errorOf, loginRuntime, type LoginSetup, T0 } from "../../../test/support/cli-auth.js"
import { ISSUER } from "../../../test/support/fake-idp.js"
import { CONFIG_PATH, execute } from "../../../test/support/fake-runtime.js"
import {
  cachedLogin,
  cacheText,
  loginFile,
  loginKey,
  TOKEN_DIR,
  TOKEN_FILE,
} from "../../../test/support/oauth.js"
import { run } from "../run.js"

function setup(options: LoginSetup = {}) {
  const { idp, runtime } = loginRuntime(options)
  return { idp, runtime, cli: (args: readonly string[]) => execute(run, args, runtime) }
}

describe("profiles that share a login", () => {
  /** Profiles of the same issuer and client: one login for all, whatever their names. */
  const profiles = (names: readonly string[]) =>
    JSON.stringify({
      profiles: Object.fromEntries(
        names.map((name, index) => [
          name,
          {
            url: `http://localhost:${String(8112 + index)}/engine-rest`,
            auth: { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" },
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
        profiles: { Prod: { auth: { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" } } },
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
    const auth = { type: "oauth", issuer: ISSUER, clientId: "pulse-cli" }
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
    // "env" stores only its type: issuer and client come from PULSE_CLI_OAUTH_*; "plain" is Basic
    const env = {
      PULSE_CLI_OAUTH_ISSUER: ISSUER,
      PULSE_CLI_OAUTH_CLIENT_ID: "pulse-cli",
      PULSE_CLI_PASSWORD: "pw",
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
    // with PULSE_CLI_AUTH=oauth the Basic profile gets a login of its own, never that of "env"
    const oauth = setup({
      runtime: { env: { ...env, PULSE_CLI_AUTH: "oauth" } },
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
