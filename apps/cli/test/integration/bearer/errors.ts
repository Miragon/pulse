/**
 * Bearer tokens the gateway refuses: a 401 for a forged token, a 403 for a token without the
 * engine audience, and a 401 for a JWT that expired within pulse-cli's grace.
 */

import { setTimeout as sleep } from "node:timers/promises"
import { expect, it } from "vitest"
import { globalFlag } from "../support/catalog.js"
import { expectError } from "../support/expect.js"
import { audiencesOf, expiryOf, tamperedJwt } from "../support/jwt.js"
import { CLIENTS, directLogin } from "../support/keycloak.js"
import {
  AUDIENCE,
  COUNT_REQUEST,
  countArgs,
  EXPIRY_GRACE_MS,
  expiryIso,
  explanation,
  GATEWAY_SKEW_MS,
  type BearerSuite,
} from "./suite.js"

export function registerErrors(suite: BearerSuite): void {
  const { top, trace, remember, run } = suite

  it("explains a 401 for a tampered token and never prints the token", async () => {
    const tampered = tamperedJwt(suite.ciToken, { sub: "someone-else-it" })
    remember(tampered)
    const forged = await run(countArgs(globalFlag("verbose")), {
      env: { PULSE_CLI_TOKEN: tampered },
    })
    const error = expectError(forged, "UNAUTHORIZED", 4)
    expect(error.status).toBe(401)
    expect(explanation(error)).toContain("Jwt verification fails")
    expect(error.hint).toMatch(/rejected the bearer token from PULSE_CLI_TOKEN/i)
    // a JWT: the hint names what to check in it; it has not expired, so not the expiry
    expect(error.hint).toContain(top().issuer)
    expect(error.hint).toContain(`expires at ${expiryIso(suite.ciToken)}`)
    expect(error.hint).toContain("trusts the key that signed it")
    // no refresh, no second attempt
    expect(trace(forged)).toEqual([COUNT_REQUEST, "< 401"])
  })

  it("explains a 403 for a token without the engine audience", async () => {
    const foreign = (await directLogin(top().issuer, CLIENTS.noAudience, "openid")).accessToken
    remember(foreign)
    expect(audiencesOf(foreign)).not.toContain(AUDIENCE)
    const result = await run(countArgs(globalFlag("verbose")), {
      env: { PULSE_CLI_TOKEN: foreign },
    })
    const error = expectError(result, "FORBIDDEN", 4)
    expect(error.status).toBe(403)
    expect(explanation(error)).toContain("Audiences in Jwt are not allowed")
    expect(error.hint).toMatch(/roles|scopes/i)
    expect(trace(result)).toEqual([COUNT_REQUEST, "< 403"])
  })

  it("sends a JWT that expired less than 30 s ago and explains the 401 with its expiry", async () => {
    const token = (await directLogin(top().issuer, CLIENTS.short, "openid")).accessToken
    remember(token)
    // expired at the gateway (1 s skew), but within pulse-cli's grace
    await sleep(Math.max(0, expiryOf(token) + GATEWAY_SKEW_MS - Date.now()))
    const result = await run(countArgs(globalFlag("verbose")), { env: { PULSE_CLI_TOKEN: token } })
    expect(Date.now()).toBeLessThan(expiryOf(token) + EXPIRY_GRACE_MS)
    const error = expectError(result, "UNAUTHORIZED", 4)
    expect(error.status).toBe(401)
    expect(explanation(error)).toContain("Jwt is expired")
    expect(error.hint).toMatch(/rejected the bearer token from PULSE_CLI_TOKEN/i)
    // pulse-cli knows exp has passed, so the hint says so instead of a list of things to check
    expect(error.hint).toContain(`It expired at ${expiryIso(token)}`)
    expect(trace(result)).toEqual([COUNT_REQUEST, "< 401"])
  })
}
