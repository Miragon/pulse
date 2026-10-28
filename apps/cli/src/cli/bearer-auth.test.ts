/**
 * Bearer tokens end to end through `run()`, part 2: `auth status` with a bearer token (src/cli/bearer.test.ts has the sources, the wire and the hints).
 */

import { describe, expect, it } from "vitest"
import { jwtWith, NOW_S, VALID_CLAIMS } from "../../test/support/bearer.js"
import { errorOf, profiles, server } from "../../test/support/cli-bearer.js"
import {
  CONFIG_PATH,
  execute,
  fakeRuntime,
  type FakeRuntimeOptions,
} from "../../test/support/fake-runtime.js"
import { run } from "./run.js"

const JWT = jwtWith(VALID_CLAIMS)
const EXPIRED = jwtWith({ ...VALID_CLAIMS, exp: NOW_S - 31 })

async function cli(args: readonly string[], options: FakeRuntimeOptions = {}, status = 200) {
  const fake = server(status)
  const outcome = await execute(run, args, fakeRuntime({ fetch: fake.fetch, ...options }))
  return { ...outcome, requests: fake.requests }
}

describe("pulse-cli auth with a bearer token", () => {
  it("shows the source and the claims of a JWT without the token", async () => {
    const result = await cli(["auth", "status"], { env: { PULSE_CLI_TOKEN: JWT } })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      type: "bearer",
      profile: null,
      source: "env",
      origin: "PULSE_CLI_TOKEN",
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
    // a Basic profile: the error is about the piped token, not "needs a bearer token"
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
    const result = await cli(["auth", "status"], { env: { PULSE_CLI_TOKEN: EXPIRED } })
    expect(result.code).toBe(4)
    expect(JSON.parse(result.stdout)).toMatchObject({
      expired: true,
      expiresAt: "2023-11-14T22:12:49.000Z",
    })
    expect(errorOf(result.stderr).code).toBe("TOKEN_EXPIRED")
  })

  it("says that auth status needs a bearer token, and how to use one that is set", async () => {
    const result = await cli(["auth", "status"], {
      env: { PULSE_CLI_USERNAME: "demo", PULSE_CLI_PASSWORD: "x" },
    })
    expect(errorOf(result.stderr).message).toBe(
      "pulse-cli auth status needs a bearer token, but the configuration uses basic",
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
    expect(await status("b2", { CI_PW: "x", PULSE_CLI_TOKEN: "abc" })).toEqual({
      code: "CONFIG",
      exitCode: 3,
      message: 'pulse-cli auth status needs a bearer token, but profile "b2" uses basic',
      hint: 'A bearer token is set (from PULSE_CLI_TOKEN) but not used: Basic auth is selected by the auth.type of profile "b2"; use it with PULSE_CLI_AUTH=bearer.',
    })
    // the password variable is not set: still about the token, not about the password
    expect((await status("b2", { PULSE_CLI_TOKEN: "abc" })).hint).toBe(
      'A bearer token is set (from PULSE_CLI_TOKEN) but not used: Basic auth is selected by the auth.type of profile "b2"; use it with PULSE_CLI_AUTH=bearer.',
    )
    expect((await status("nn", { PULSE_CLI_TOKEN: "abc" })).hint).toBe(
      'A bearer token is set (from PULSE_CLI_TOKEN) but not used: bearer auth is switched off by the auth.type of profile "nn"; use it with PULSE_CLI_AUTH=bearer.',
    )
    expect((await status("offp", { CI_T: "abc" })).hint).toBe(
      'Bearer auth is switched off by the auth.type of profile "offp". Switch it on: pulse-cli config set offp --auth bearer',
    )
    expect((await status("offp", { CI_T: "abc", PULSE_CLI_AUTH: "none" })).hint).toBe(
      "Bearer auth is switched off by PULSE_CLI_AUTH=none. Switch it on: PULSE_CLI_AUTH=bearer",
    )
    // following the hints works
    const followed = await cli(["auth", "status", "--profile", "b2"], {
      files,
      env: { CI_PW: "x", PULSE_CLI_TOKEN: "abc", PULSE_CLI_AUTH: "bearer" },
    })
    expect(followed.code).toBe(0)
    expect(JSON.parse(followed.stdout)).toMatchObject({ type: "bearer", origin: "PULSE_CLI_TOKEN" })
  })
})
