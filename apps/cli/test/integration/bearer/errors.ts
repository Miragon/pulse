/**
 * Bearer tokens the gateway or the CLI refuses: 401 and 403, an explicit Authorization header,
 * a token next to a username, a token in the wrong place, an unused exported token, expired JWTs.
 */

import { readFile } from "node:fs/promises"
import { setTimeout as sleep } from "node:timers/promises"
import { expect, it } from "vitest"
import { globalFlag } from "../support/catalog.js"
import { expectError, expectSuccess } from "../support/expect.js"
import { audiencesOf, expiryOf, tamperedJwt } from "../support/jwt.js"
import { CLIENTS, directLogin, USER } from "../support/keycloak.js"
import { MASKED_BEARER, SENT_REQUEST } from "../support/trace.js"
import type { BearerStatusOutput, ConfigShowOutput, Count, DryRunOutput } from "../support/types.js"
import {
  ANY_AUTHORIZATION,
  AUDIENCE,
  COUNT_REQUEST,
  countArgs,
  EXPIRY_GRACE_MS,
  expiryIso,
  explanation,
  GARBAGE,
  GATEWAY_SKEW_MS,
  headerValue,
  PROFILE,
  profileArgs,
  STRAY_PASSWORD,
  TOKEN_ENV,
  type BearerSuite,
} from "./suite.js"

export function registerErrors(suite: BearerSuite): void {
  const { top, trace, remember, run, writeProfile, profiles } = suite

  it("explains a 401 for a tampered or garbage token and never prints the token", async () => {
    const tampered = tamperedJwt(suite.ciToken, { sub: "someone-else-it" })
    remember(tampered)
    const forged = await run(countArgs(globalFlag("verbose")), {
      env: { OPERATE_TOKEN: tampered },
    })
    const error = expectError(forged, "UNAUTHORIZED", 4)
    expect(error.status).toBe(401)
    expect(explanation(error)).toContain("Jwt verification fails")
    expect(error.hint).toMatch(/rejected the bearer token from OPERATE_TOKEN/i)
    // a JWT: the hint names what to check in it; it has not expired, so not the expiry
    expect(error.hint).toContain(top().issuer)
    expect(error.hint).toContain(`expires at ${expiryIso(suite.ciToken)}`)
    expect(error.hint).toContain("trusts the key that signed it")
    // no refresh, no second attempt
    expect(trace(forged)).toEqual([COUNT_REQUEST, "< 401"])

    const garbage = await run(countArgs(globalFlag("verbose")), {
      env: { OPERATE_TOKEN: GARBAGE },
    })
    const garbageError = expectError(garbage, "UNAUTHORIZED", 4)
    expect(explanation(garbageError)).toContain("Jwt is not in the form")
    expect(garbageError.hint).toMatch(/rejected the bearer token from OPERATE_TOKEN/i)
    expect(trace(garbage)).toEqual([COUNT_REQUEST, "< 401"])

    const piped = await run(countArgs(globalFlag("auth-token-stdin")), { stdin: `${GARBAGE}\n` })
    expect(expectError(piped, "UNAUTHORIZED", 4).hint).toMatch(
      /rejected the bearer token from --auth-token-stdin/i,
    )
  })

  it("explains a 403 for a token without the engine audience", async () => {
    const foreign = (await directLogin(top().issuer, CLIENTS.noAudience, "openid")).accessToken
    remember(foreign)
    expect(audiencesOf(foreign)).not.toContain(AUDIENCE)
    const result = await run(countArgs(globalFlag("verbose")), {
      env: { OPERATE_TOKEN: foreign },
    })
    const error = expectError(result, "FORBIDDEN", 4)
    expect(error.status).toBe(403)
    expect(explanation(error)).toContain("Audiences in Jwt are not allowed")
    expect(error.hint).toMatch(/roles|scopes/i)
    expect(trace(result)).toEqual([COUNT_REQUEST, "< 403"])
  })

  it("refuses bearer together with an explicit Authorization header before any request", async () => {
    const flag = await run(
      ["ping", globalFlag("header"), "Authorization: x", globalFlag("verbose")],
      { env: { OPERATE_TOKEN: suite.ciToken } },
    )
    expect(explanation(expectError(flag, "CONFIG", 3))).toContain("Authorization")
    expect(flag.stderr).not.toMatch(SENT_REQUEST)

    const other = "other-token-it"
    remember(other)
    const headers = await run(
      countArgs(
        globalFlag("auth"),
        "bearer",
        globalFlag("auth-token-stdin"),
        globalFlag("verbose"),
      ),
      { stdin: `${suite.ciToken}\n`, env: { OPERATE_HEADERS: `authorization: Bearer ${other}` } },
    )
    expect(explanation(expectError(headers, "CONFIG", 3))).toContain("OPERATE_HEADERS")
    expect(headers.stderr).not.toMatch(SENT_REQUEST)
  })

  it("asks for an explicit --auth when a token and a username are both set", async () => {
    const env = {
      OPERATE_TOKEN: suite.ciToken,
      OPERATE_USERNAME: "operateit",
      OPERATE_PASSWORD: STRAY_PASSWORD,
    }
    const both = await run(countArgs(globalFlag("verbose")), { env })
    expect(explanation(expectError(both, "CONFIG", 3))).toContain("--auth")
    expect(both.stderr).not.toMatch(SENT_REQUEST)
    const flags = await run(
      countArgs(globalFlag("auth-user"), "operateit", globalFlag("auth-token-stdin")),
      { stdin: `${suite.ciToken}\n` },
    )
    expectError(flags, "CONFIG", 3)

    // an explicit type decides
    const bearer = await run(countArgs(globalFlag("auth"), "bearer", globalFlag("verbose")), {
      env,
    })
    expect(trace(expectSuccess(bearer))).toEqual([COUNT_REQUEST, "< 200"])
    expect(bearer.stderr).toMatch(MASKED_BEARER)
    const viaEnv = await run(countArgs(), { env: { ...env, OPERATE_AUTH: "bearer" } })
    expectSuccess(viaEnv)
    // --auth none switches it off: the gateway gets no token at all
    const none = await run(countArgs(globalFlag("auth"), "none", globalFlag("verbose")), {
      env: { OPERATE_TOKEN: suite.ciToken },
    })
    expect(explanation(expectError(none, "UNAUTHORIZED", 4))).toContain("Jwt is missing")
    expect(none.stderr).not.toMatch(ANY_AUTHORIZATION)
    // config show reports a token the resolved type does not use
    for (const type of ["basic", "none"]) {
      const show = await run(["config", "show", globalFlag("auth"), type], { env })
      expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
        values: {
          auth: { value: type, source: "flag" },
          token: { value: "***", source: "env", unused: expect.stringContaining(`--auth ${type}`) },
        },
      })
    }
  })

  it("never repeats a token typed in the wrong place, and sends nothing", async () => {
    // an opaque token in the form of a variable name (GitHub style)
    const opaque = "tok_SECRETitabcdefghijklmnopqrstuvwxyz0123"
    remember(opaque)
    const auth = globalFlag("auth")
    const usage = [
      // before the command: commander takes the token for the command name
      await run([globalFlag("auth-token-stdin"), suite.ciToken, ...countArgs()], {
        stdin: suite.ciToken,
      }),
      await run([auth, "bearer", suite.ciToken, ...countArgs()]),
      // after --auth bearer, and to auth status
      await run(countArgs(auth, "bearer", suite.ciToken, globalFlag("verbose"))),
      await run(["auth", "status", suite.ciToken]),
    ]
    for (const result of usage) {
      expectError(result, "USAGE", 2)
      expect(result.stderr).not.toMatch(SENT_REQUEST)
    }
    expect(usage[1]?.errorJson().hint).toContain("--auth takes only the type")
    // the token as the auth type
    const typeErrors = [
      await run(countArgs(auth, `Bearer ${suite.ciToken}`)),
      await run(countArgs(), { env: { OPERATE_AUTH: `Bearer ${suite.ciToken}` } }),
    ]
    for (const result of typeErrors) {
      expect(expectError(result, "CONFIG", 3).message).toBe(
        "Unsupported auth type (not one of none, basic, oauth, bearer)",
      )
    }
    // the token as the name of its variable: refused, nothing stored
    const before = await readFile(suite.profilesFile, "utf8")
    const named = await run(
      ["config", "set", "it-misnamed", auth, "bearer", "--auth-token-env", opaque],
      profiles(),
    )
    expectError(named, "CONFIG", 3)
    expect(await readFile(suite.profilesFile, "utf8")).toBe(before)
  })

  it("names an exported token that a typed profile does not use in its auth hints", async () => {
    await writeProfile("it-sso", {
      url: top().url,
      auth: { type: "oauth", issuer: top().issuer, clientId: CLIENTS.public },
    })
    await writeProfile("it-basic", {
      url: top().url,
      auth: { type: "basic", username: "operateit", passwordEnv: "IT_STRAY_PASSWORD" },
    })
    const env = { OPERATE_TOKEN: suite.ciToken, IT_STRAY_PASSWORD: STRAY_PASSWORD }
    const note = "A bearer token is set (from OPERATE_TOKEN) but not used"
    // OAuth without a login: LOGIN_REQUIRED, whose hint also points to the token
    const sso = await run(countArgs(...profileArgs("it-sso")), profiles(env))
    expect(expectError(sso, "LOGIN_REQUIRED", 4).hint).toContain(note)
    // Basic auth: the gateway refuses the credentials; the hint names the unused token
    const basic = await run(countArgs(...profileArgs("it-basic")), profiles(env))
    expect(expectError(basic, "UNAUTHORIZED", 4).hint).toContain(note)
    // following the hint sends the token
    const sent = await run(
      countArgs(...profileArgs("it-sso"), globalFlag("auth"), "bearer"),
      profiles(env),
    )
    expect(expectSuccess(sent).json<Count>().count).toBeGreaterThanOrEqual(0)
    // auth status: OAuth or a bearer token; the hint says how to use the exported one
    const status = await run(["auth", "status", ...profileArgs("it-basic")], profiles(env))
    expect(expectError(status, "CONFIG", 3)).toMatchObject({
      message:
        'operate auth status needs OAuth or a bearer token, but profile "it-basic" uses basic',
      hint: expect.stringContaining("use it with OPERATE_AUTH=bearer"),
    })
  })

  it("sends a JWT that expired less than 30 s ago and explains the 401 with its expiry", async () => {
    const token = (await directLogin(top().issuer, CLIENTS.short, "openid")).accessToken
    remember(token)
    // expired at the gateway (1 s skew), but within operate's grace
    await sleep(Math.max(0, expiryOf(token) + GATEWAY_SKEW_MS - Date.now()))
    const result = await run(countArgs(globalFlag("verbose")), { env: { OPERATE_TOKEN: token } })
    expect(Date.now()).toBeLessThan(expiryOf(token) + EXPIRY_GRACE_MS)
    const error = expectError(result, "UNAUTHORIZED", 4)
    expect(error.status).toBe(401)
    expect(explanation(error)).toContain("Jwt is expired")
    expect(error.hint).toMatch(/rejected the bearer token from OPERATE_TOKEN/i)
    // operate knows exp has passed, so the hint says so instead of a list of things to check
    expect(error.hint).toContain(`It expired at ${expiryIso(token)}`)
    expect(trace(result)).toEqual([COUNT_REQUEST, "< 401"])
  })

  it("refuses a JWT that expired more than 30 s ago with TOKEN_EXPIRED before sending it", async () => {
    // issued in beforeAll: usually the other tests have spent most of this wait
    await sleep(Math.max(0, expiryOf(suite.staleToken) + EXPIRY_GRACE_MS + 2_000 - Date.now()))
    const expired = expiryIso(suite.staleToken)
    const result = await run(countArgs(globalFlag("verbose")), {
      env: { OPERATE_TOKEN: suite.staleToken },
    })
    const text = explanation(expectError(result, "TOKEN_EXPIRED", 4))
    expect(text).toContain("OPERATE_TOKEN")
    expect(text).toContain(expired)
    expect(text).toMatch(/fetch a new one/i)
    expect(result.stdout).toBe("")
    expect(result.stderr).not.toMatch(SENT_REQUEST)

    const piped = await run(countArgs(globalFlag("auth-token-stdin"), globalFlag("verbose")), {
      stdin: `${suite.staleToken}\n`,
    })
    expect(explanation(expectError(piped, "TOKEN_EXPIRED", 4))).toContain("--auth-token-stdin")
    expect(piped.stderr).not.toMatch(SENT_REQUEST)

    const fromProfile = await run(
      countArgs(...profileArgs(PROFILE.fixed), globalFlag("verbose")),
      profiles({ [TOKEN_ENV]: suite.staleToken }),
    )
    expect(explanation(expectError(fromProfile, "TOKEN_EXPIRED", 4))).toContain(TOKEN_ENV)
    expect(fromProfile.stderr).not.toMatch(SENT_REQUEST)

    const ping = await run(["ping", globalFlag("verbose")], {
      env: { OPERATE_TOKEN: suite.staleToken },
    })
    expectError(ping, "TOKEN_EXPIRED", 4)
    expect(ping.stderr).not.toMatch(SENT_REQUEST)
    // a preview sends nothing either, so it shows the request and says why it would fail
    const preview = await run(countArgs(globalFlag("dry-run")), {
      env: { OPERATE_TOKEN: suite.staleToken },
    })
    const request = expectSuccess(preview).json<DryRunOutput>()
    expect(headerValue(request.headers, "authorization")).toBe("Bearer ***")
    expect(preview.stderr).toMatch(/^Note: .*expired/m)
    expect(preview.stderr).not.toMatch(SENT_REQUEST)
    // auth status shows the token's claims, then fails the same way
    const status = await run(["auth", "status"], { env: { OPERATE_TOKEN: suite.staleToken } })
    expectError(status, "TOKEN_EXPIRED", 4)
    expect(status.json<BearerStatusOutput>()).toMatchObject({
      format: "jwt",
      user: USER.username,
      expiresAt: expired,
      expired: true,
    })
  })
}
