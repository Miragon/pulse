/**
 * Bearer tokens and the config: masking in --verbose and --dry-run, profiles with a token variable
 * or a literal token, config unset, auth status, and auth login and logout, which bearer refuses.
 */

import { stat } from "node:fs/promises"
import { expect, it } from "vitest"
import { argv, globalFlag } from "../support/catalog.js"
import { expectError, expectSuccess } from "../support/expect.js"
import { claimsOf } from "../support/jwt.js"
import { MASKED_BEARER, SENT_REQUEST } from "../support/trace.js"
import type {
  BearerStatusOutput,
  ConfigShowOutput,
  DryRunOutput,
  PingOutput,
  ProcessDefinition,
} from "../support/types.js"
import {
  ANY_AUTHORIZATION,
  AUDIENCE,
  COUNT_REQUEST,
  countArgs,
  expiryIso,
  explanation,
  GARBAGE,
  headerValue,
  MASKED_CURL,
  PROFILE,
  profileArgs,
  revealedHeader,
  SERVICE_ACCOUNT,
  TOKEN_ENV,
  type BearerSuite,
} from "./suite.js"

export function registerProfiles(suite: BearerSuite): void {
  const { top, trace, expectHidden, run, readProfiles, profiles } = suite

  it("masks the token in the --verbose trace and the --dry-run preview unless --show-secrets", async () => {
    const env = { OPERATE_TOKEN: suite.ciToken }
    const masked = await run(countArgs(globalFlag("verbose")), { env })
    expect(expectSuccess(masked).stderr).toMatch(MASKED_BEARER)

    const revealed = await run(
      countArgs(globalFlag("verbose"), globalFlag("show-secrets")),
      { env },
      suite.ciToken,
    )
    expect(expectSuccess(revealed).stderr).toMatch(revealedHeader(suite.ciToken))
    // the secret check knows the token, so its checks of every other run are not vacuous
    expect(() => {
      expectHidden(revealed)
    }).toThrow(/stderr reveals a secret/)

    const preview = await run(countArgs(globalFlag("dry-run")), { env })
    const request = expectSuccess(preview).json<DryRunOutput>()
    expect(headerValue(request.headers, "authorization")).toBe("Bearer ***")
    expect(request.curl).toMatch(MASKED_CURL)
    expect(preview.stderr).not.toMatch(SENT_REQUEST)

    const pingPreview = await run(["ping", globalFlag("dry-run")], { env })
    const pingRequest = expectSuccess(pingPreview).json<DryRunOutput>()
    expect(headerValue(pingRequest.headers, "authorization")).toBe("Bearer ***")

    const shown = await run(
      countArgs(globalFlag("dry-run"), globalFlag("show-secrets")),
      { env },
      suite.ciToken,
    )
    const { headers, curl } = expectSuccess(shown).json<DryRunOutput>()
    expect(headerValue(headers, "authorization")).toBe(`Bearer ${suite.ciToken}`)
    expect(curl).toContain(suite.ciToken)
  })

  it("uses a profile whose tokenEnv config set wrote, and masks the token in config show", async () => {
    const set = await run(
      [
        "config",
        "set",
        PROFILE.tokenEnv,
        globalFlag("url"),
        top().url,
        globalFlag("auth"),
        "bearer",
        "--auth-token-env",
        TOKEN_ENV,
      ],
      profiles(),
    )
    // IT_TOKEN is not set in the environment of config set
    expect(expectSuccess(set).stderr).toMatch(/^Warning: .*--auth-token-env/m)
    expect((await readProfiles())[PROFILE.tokenEnv]?.auth).toEqual({
      type: "bearer",
      tokenEnv: TOKEN_ENV,
    })
    if (process.platform !== "win32") {
      expect((await stat(suite.profilesFile)).mode & 0o777).toBe(0o600)
    }

    const withToken = profiles({ [TOKEN_ENV]: suite.ciToken })
    const list = await run(
      [...argv("process-definition list"), ...profileArgs(PROFILE.tokenEnv)],
      withToken,
    )
    expect(expectSuccess(list).json<ProcessDefinition[]>()).toEqual(expect.any(Array))
    const ping = await run(["ping", ...profileArgs(PROFILE.tokenEnv)], withToken)
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
      url: top().url,
      reachable: true,
      auth: "bearer",
    })

    const show = await run(["config", "show", ...profileArgs(PROFILE.tokenEnv)], withToken)
    expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
      profile: PROFILE.tokenEnv,
      values: {
        url: { value: top().url, source: "profile" },
        auth: { value: "bearer", source: "profile" },
        token: { value: "***", source: "profile" },
      },
    })
    const table = await run(
      ["config", "show", ...profileArgs(PROFILE.tokenEnv), "-o", "table"],
      withToken,
    )
    expect(expectSuccess(table).stdout).toMatch(/^token\s+\*\*\*\s+profile\s*$/m)
    const revealed = await run(
      ["config", "show", ...profileArgs(PROFILE.tokenEnv), globalFlag("show-secrets")],
      withToken,
      suite.ciToken,
    )
    expect(expectSuccess(revealed).json<ConfigShowOutput>()).toMatchObject({
      values: { token: { value: suite.ciToken } },
    })
  })

  it("fails with CONFIG naming an unset tokenEnv variable, unless OPERATE_TOKEN wins", async () => {
    for (const value of [undefined, ""]) {
      const result = await run(
        ["ping", ...profileArgs(PROFILE.fixed), globalFlag("verbose")],
        profiles({ [TOKEN_ENV]: value }),
      )
      expect(explanation(expectError(result, "CONFIG", 3))).toContain(TOKEN_ENV)
      expect(result.stderr).not.toMatch(SENT_REQUEST)
    }
    // OPERATE_TOKEN comes first, so the profile's variable is not read (like the passwordEnv of Basic auth)
    const override = await run(
      ["ping", ...profileArgs(PROFILE.fixed)],
      profiles({ OPERATE_TOKEN: suite.ciToken }),
    )
    expect(expectSuccess(override).json<PingOutput>()).toMatchObject({ auth: "bearer" })
    // and a garbage OPERATE_TOKEN is really what is sent
    const garbage = await run(
      countArgs(...profileArgs(PROFILE.fixed), globalFlag("verbose")),
      profiles({ [TOKEN_ENV]: suite.ciToken, OPERATE_TOKEN: GARBAGE }),
    )
    expectError(garbage, "UNAUTHORIZED", 4)
    expect(trace(garbage)).toEqual([COUNT_REQUEST, "< 401"])
  })

  it("stores a literal token from stdin with a warning; config unset removes single keys", async () => {
    const set = await run(
      [
        "config",
        "set",
        PROFILE.literal,
        globalFlag("url"),
        top().url,
        globalFlag("auth"),
        "bearer",
        globalFlag("auth-token-stdin"),
      ],
      profiles({}, { stdin: `${suite.ciToken}\n` }),
    )
    expect(expectSuccess(set).stderr).toMatch(/^Warning: .*plain text/m)
    expect(set.stderr).toContain("--auth-token-env")
    expect((await readProfiles())[PROFILE.literal]?.auth).toEqual({
      type: "bearer",
      token: suite.ciToken,
    })
    const ping = await run(["ping", ...profileArgs(PROFILE.literal)], profiles())
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({ auth: "bearer" })
    const edit = (...args: string[]) => run(["config", ...args], profiles())

    expectSuccess(await edit("unset", PROFILE.literal, "token"))
    expect((await readProfiles())[PROFILE.literal]?.auth).toEqual({ type: "bearer" })
    const missing = await run(
      ["ping", ...profileArgs(PROFILE.literal), globalFlag("verbose")],
      profiles(),
    )
    expectError(missing, "CONFIG", 3)
    expect(missing.stderr).not.toMatch(SENT_REQUEST)

    expectSuccess(await edit("set", PROFILE.literal, "--auth-token-env", TOKEN_ENV))
    expect((await readProfiles())[PROFILE.literal]?.auth).toEqual({
      type: "bearer",
      tokenEnv: TOKEN_ENV,
    })
    expectSuccess(await edit("unset", PROFILE.literal, "tokenEnv"))
    expect((await readProfiles())[PROFILE.literal]?.auth).toEqual({ type: "bearer" })

    expectSuccess(await edit("unset", PROFILE.literal, "auth"))
    const profile = (await readProfiles())[PROFILE.literal]
    expect(profile).toMatchObject({ url: top().url })
    expect(profile).not.toHaveProperty("auth")
    // nothing is sent now, and the gateway says so
    const none = await run(
      countArgs(...profileArgs(PROFILE.literal), globalFlag("verbose")),
      profiles(),
    )
    expect(explanation(expectError(none, "UNAUTHORIZED", 4))).toContain("Jwt is missing")
    expect(none.stderr).not.toMatch(ANY_AUTHORIZATION)
  })

  it("shows subject, issuer, audience and expiry in auth status, never the token", async () => {
    const claims = {
      type: "bearer",
      command: null,
      cached: false,
      format: "jwt",
      subject: claimsOf(suite.ciToken).sub,
      user: SERVICE_ACCOUNT,
      issuer: top().issuer,
      audience: expect.arrayContaining([AUDIENCE]) as unknown,
      expiresAt: expiryIso(suite.ciToken),
      expired: false,
    }
    const fromEnv = await run(["auth", "status"], { env: { OPERATE_TOKEN: suite.ciToken } })
    expect(expectSuccess(fromEnv).json<BearerStatusOutput>()).toEqual({
      ...claims,
      profile: null,
      source: "env",
      origin: "OPERATE_TOKEN",
    })
    const fromProfile = await run(
      ["auth", "status", ...profileArgs(PROFILE.fixed)],
      profiles({ [TOKEN_ENV]: suite.ciToken }),
    )
    expect(expectSuccess(fromProfile).json<BearerStatusOutput>()).toEqual({
      ...claims,
      profile: PROFILE.fixed,
      source: "profile",
      origin: `${TOKEN_ENV} (auth.tokenEnv of profile "${PROFILE.fixed}")`,
    })
    // a piped token can be checked before it is used
    const piped = await run(["auth", "status", globalFlag("auth-token-stdin")], {
      stdin: `${suite.ciToken}\n`,
      env: { OPERATE_TOKEN: GARBAGE },
    })
    expect(expectSuccess(piped).json<BearerStatusOutput>()).toEqual({
      ...claims,
      profile: null,
      source: "flag",
      origin: "--auth-token-stdin",
    })
    const table = await run(["auth", "status", "-o", "table"], {
      env: { OPERATE_TOKEN: suite.ciToken },
    })
    expect(expectSuccess(table).stdout).toMatch(new RegExp(`^issuer\\s+${top().issuer}\\s*$`, "m"))
    expect(table.stdout).toMatch(new RegExp(`^expiresAt\\s+${expiryIso(suite.ciToken)}\\s*$`, "m"))

    // an opaque token has no claims to show, and is no reason to fail
    const opaque = await run(["auth", "status"], { env: { OPERATE_TOKEN: GARBAGE } })
    expect(expectSuccess(opaque).json<BearerStatusOutput>()).toMatchObject({
      type: "bearer",
      format: "opaque",
      subject: null,
      issuer: null,
      audience: [],
      expiresAt: null,
      expired: false,
    })
  })

  it("refuses auth login and logout for bearer tokens, which are managed outside operate", async () => {
    const quick = profiles({ [TOKEN_ENV]: suite.ciToken }, { timeoutMs: 30_000 })
    const login = await run(
      ["auth", "login", ...profileArgs(PROFILE.fixed), "--no-browser", "--login-timeout", "5000"],
      quick,
    )
    expect(expectError(login, "USAGE", 2).message).toContain("does not apply to bearer tokens")
    expect(login.stderr).not.toMatch(/^ {2}https?:\/\//m)
    const logout = await run(["auth", "logout", ...profileArgs(PROFILE.fixed)], quick)
    expect(expectError(logout, "USAGE", 2).message).toContain("does not apply to bearer tokens")
    // without a profile as well
    const envOnly = await run(["auth", "logout"], { env: { OPERATE_TOKEN: suite.ciToken } })
    expectError(envOnly, "USAGE", 2)
  })
}
