/**
 * Bearer tokens Keycloak issued, sent to the gateway: from the token variable and stdin, masked in
 * the trace, and their claims in auth status.
 */

import { expect, it } from "vitest"
import { argv, globalFlag } from "../support/catalog.js"
import { ENGINES } from "../support/engines.js"
import { expectSuccess } from "../support/expect.js"
import { audiencesOf, claimsOf, tamperedJwt } from "../support/jwt.js"
import { CLIENTS } from "../support/keycloak.js"
import { MASKED_BEARER } from "../support/trace.js"
import type { BearerStatusOutput, Count, PingOutput, ProcessDefinition } from "../support/types.js"
import {
  AUDIENCE,
  COUNT_REQUEST,
  countArgs,
  expiryIso,
  GARBAGE,
  revealedHeader,
  SERVICE_ACCOUNT,
  type BearerSuite,
} from "./suite.js"

export function registerSources(suite: BearerSuite): void {
  const { top, trace, expectHidden, run } = suite

  it("runs against a gateway that takes the tokens Keycloak issues without pulse-cli", async () => {
    const { url, issuer } = top()
    expect(claimsOf(suite.ciToken)).toMatchObject({
      iss: issuer,
      azp: CLIENTS.ci,
      preferred_username: SERVICE_ACCOUNT,
    })
    expect(audiencesOf(suite.ciToken)).toContain(AUDIENCE)
    const call = (authorization: string) => fetch(`${url}/version`, { headers: { authorization } })

    const authorized = await call(`Bearer ${suite.ciToken}`)
    expect(authorized.status).toBe(200)
    expect(await authorized.json()).toEqual({ version: ENGINES[top().engine].version })
    // the gateway takes the scheme as spelled: a pasted "bearer <token>" must be normalized
    const lowercase = await call(`bearer ${suite.ciToken}`)
    expect(lowercase.status).toBe(401)
    expect(await lowercase.text()).toBe("Jwt is missing")
    const tampered = await call(`Bearer ${tamperedJwt(suite.ciToken, { sub: "someone-else-it" })}`)
    expect(tampered.status).toBe(401)
    expect(await tampered.text()).toBe("Jwt verification fails")
    const garbage = await call(`Bearer ${GARBAGE}`)
    expect(garbage.status).toBe(401)
  })

  it("infers bearer from PULSE_CLI_TOKEN alone and sends the token on every request", async () => {
    const env = { PULSE_CLI_TOKEN: suite.ciToken }
    const list = await run([...argv("process-definition list"), globalFlag("verbose")], { env })
    expect(expectSuccess(list).json<ProcessDefinition[]>()).toEqual(expect.any(Array))
    // one request, no token request: pulse-cli neither logs in nor refreshes
    expect(trace(list)).toEqual(["> GET <engine>/process-definition", "< 200"])
    expect(list.stderr).toMatch(MASKED_BEARER)

    const count = await run(countArgs(), { env: { ...env, PULSE_CLI_AUTH: "bearer" } })
    expect(expectSuccess(count).json<Count>()).toEqual({ count: expect.any(Number) })
    const api = await run(["api", "GET", "/version"], { env })
    expect(expectSuccess(api).json()).toEqual({ version: ENGINES[top().engine].version })

    const ping = await run(["ping"], { env })
    expect(expectSuccess(ping).json<PingOutput>()).toMatchObject({
      url: top().url,
      reachable: true,
      auth: "bearer",
      user: SERVICE_ACCOUNT,
      subject: claimsOf(suite.ciToken).sub,
    })
  })

  it("reads the token from the first line of stdin with --auth-token-stdin", async () => {
    const inferred = await run(countArgs(globalFlag("auth-token-stdin"), globalFlag("verbose")), {
      stdin: `${suite.ciToken}\r\nsecond line\n`,
    })
    expect(trace(expectSuccess(inferred))).toEqual([COUNT_REQUEST, "< 200"])
    expect(inferred.stderr).toMatch(MASKED_BEARER)
  })

  it("shows the token in the --verbose trace with --show-secrets only", async () => {
    const revealed = await run(
      countArgs(globalFlag("verbose"), globalFlag("show-secrets")),
      { env: { PULSE_CLI_TOKEN: suite.ciToken } },
      suite.ciToken,
    )
    expect(expectSuccess(revealed).stderr).toMatch(revealedHeader(suite.ciToken))
    // the secret check knows the token, so its checks of every other run are not vacuous
    expect(() => {
      expectHidden(revealed)
    }).toThrow(/stderr reveals a secret/)
  })

  it("shows subject, issuer, audience and expiry in auth status, never the token", async () => {
    const status = await run(["auth", "status"], { env: { PULSE_CLI_TOKEN: suite.ciToken } })
    expect(expectSuccess(status).json<BearerStatusOutput>()).toEqual({
      type: "bearer",
      profile: null,
      source: "env",
      origin: "PULSE_CLI_TOKEN",
      command: null,
      cached: false,
      format: "jwt",
      subject: claimsOf(suite.ciToken).sub,
      user: SERVICE_ACCOUNT,
      issuer: top().issuer,
      audience: expect.arrayContaining([AUDIENCE]) as unknown,
      expiresAt: expiryIso(suite.ciToken),
      expired: false,
    })
  })
}
