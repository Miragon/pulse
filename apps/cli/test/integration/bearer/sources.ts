/**
 * Where the bearer token comes from: the gateway and Keycloak's tokens, the shell completion, the
 * token variable, stdin, a pasted prefix, tokens that are not b64tokens and a missing token.
 */

import { expect, it } from "vitest"
import { argv, globalFlag } from "../support/catalog.js"
import { ENGINES } from "../support/engines.js"
import { expectError, expectSuccess } from "../support/expect.js"
import { audiencesOf, claimsOf, tamperedJwt } from "../support/jwt.js"
import { CLIENTS } from "../support/keycloak.js"
import { MASKED_BEARER, SENT_REQUEST } from "../support/trace.js"
import type {
  ConfigShowOutput,
  Count,
  DryRunOutput,
  PingOutput,
  ProcessDefinition,
} from "../support/types.js"
import {
  AUDIENCE,
  COUNT_REQUEST,
  countArgs,
  explanation,
  GARBAGE,
  headerValue,
  INVALID_TOKENS,
  PROFILE,
  SERVICE_ACCOUNT,
  type BearerSuite,
} from "./suite.js"

export function registerSources(suite: BearerSuite): void {
  const { top, trace, remember, run } = suite

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

  it("completes bearer for --auth and the token flags in the shell completion", async () => {
    /** Candidate values of `pulse-cli __complete <words...>` (the completion scripts' protocol). */
    const complete = async (...words: string[]) => {
      const result = expectSuccess(await run(["__complete", ...words]))
      return result.stdout.split("\n").map((line) => line.split("\t")[0])
    }
    expect(await complete("ping", globalFlag("auth"), "")).toContain("bearer")
    expect(await complete("process-definition", "count", "--auth-")).toContain(
      globalFlag("auth-token-stdin"),
    )
    expect(await complete("config", "set", PROFILE.tokenEnv, "--auth-")).toEqual(
      expect.arrayContaining(["--auth-token-env", globalFlag("auth-token-stdin")]),
    )
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

    const show = await run(["config", "show"], { env })
    expect(expectSuccess(show).json<ConfigShowOutput>()).toMatchObject({
      values: {
        auth: { value: "bearer", source: "env" },
        token: { value: "***", source: "env" },
      },
    })
  })

  it("reads the token from the first line of stdin with --auth-token-stdin", async () => {
    const explicit = await run(
      countArgs(globalFlag("auth"), "bearer", globalFlag("auth-token-stdin")),
      { stdin: `${suite.ciToken}\n` },
    )
    expect(expectSuccess(explicit).json<Count>()).toEqual({ count: expect.any(Number) })

    // the flag alone selects bearer; only the first line counts
    const inferred = await run(countArgs(globalFlag("auth-token-stdin"), globalFlag("verbose")), {
      stdin: `${suite.ciToken}\r\nsecond line\n`,
    })
    expect(trace(expectSuccess(inferred))).toEqual([COUNT_REQUEST, "< 200"])
    expect(inferred.stderr).toMatch(MASKED_BEARER)

    // the flag beats PULSE_CLI_TOKEN
    const precedence = await run(countArgs(globalFlag("auth-token-stdin")), {
      stdin: `${suite.ciToken}\n`,
      env: { PULSE_CLI_TOKEN: GARBAGE },
    })
    expectSuccess(precedence)
  })

  it("refuses an empty token on stdin and a second reader of stdin before any request", async () => {
    for (const stdin of ["", "\n", "\r\n"]) {
      const empty = await run(countArgs(globalFlag("auth-token-stdin"), globalFlag("verbose")), {
        stdin,
      })
      expectError(empty, "USAGE", 2)
      expect(empty.stderr).not.toMatch(SENT_REQUEST)
    }
    const body = await run(
      [
        ...argv("process-instance query", [], { body: "-" }),
        globalFlag("auth-token-stdin"),
        globalFlag("verbose"),
      ],
      { stdin: `${suite.ciToken}\n` },
    )
    expectError(body, "USAGE", 2)
    expect(body.stderr).not.toMatch(SENT_REQUEST)
    const password = await run(
      countArgs(
        globalFlag("auth-token-stdin"),
        globalFlag("auth-password-stdin"),
        globalFlag("verbose"),
      ),
      { stdin: `${suite.ciToken}\n` },
    )
    expectError(password, "USAGE", 2)
    expect(password.stderr).not.toMatch(SENT_REQUEST)
  })

  it('strips a pasted "Bearer " prefix and surrounding whitespace', async () => {
    const pasted = await run(countArgs(globalFlag("verbose")), {
      env: { PULSE_CLI_TOKEN: `Bearer ${suite.ciToken}` },
    })
    expect(trace(expectSuccess(pasted))).toEqual([COUNT_REQUEST, "< 200"])
    expect(pasted.stderr).toMatch(MASKED_BEARER)

    // the gateway refuses "bearer" in lower case (first test): pulse-cli sends the token alone
    const piped = await run(countArgs(globalFlag("auth-token-stdin")), {
      stdin: `  bearer ${suite.ciToken}\t\r\n`,
    })
    expect(expectSuccess(piped).json<Count>()).toEqual({ count: expect.any(Number) })

    const preview = await run(
      countArgs(globalFlag("dry-run"), globalFlag("show-secrets")),
      { env: { PULSE_CLI_TOKEN: ` BEARER ${suite.ciToken} ` } },
      suite.ciToken,
    )
    const { headers } = expectSuccess(preview).json<DryRunOutput>()
    expect(headerValue(headers, "authorization")).toBe(`Bearer ${suite.ciToken}`)
  })

  it("refuses a token that is not an RFC 6750 b64token without repeating it", async () => {
    for (const token of INVALID_TOKENS) {
      remember(token, ...token.split(/[\s=,]/))
      const result = await run(countArgs(globalFlag("verbose")), {
        env: { PULSE_CLI_TOKEN: token },
      })
      expectError(result, "CONFIG", 3)
      expect(result.stderr).not.toMatch(SENT_REQUEST)
    }
    const piped = await run(countArgs(globalFlag("auth-token-stdin"), globalFlag("verbose")), {
      stdin: `${INVALID_TOKENS[0] ?? ""}\n`,
    })
    expect(explanation(expectError(piped, "CONFIG", 3))).toContain("--auth-token-stdin")
    expect(piped.stderr).not.toMatch(SENT_REQUEST)
  })

  it("fails with CONFIG before any request when bearer is selected without a token", async () => {
    const result = await run(["ping", globalFlag("auth"), "bearer", globalFlag("verbose")])
    const text = explanation(expectError(result, "CONFIG", 3))
    expect(text).toContain("PULSE_CLI_TOKEN")
    expect(text).toContain("--auth-token-stdin")
    expect(result.stderr).not.toMatch(SENT_REQUEST)

    const viaEnv = await run(["ping", globalFlag("verbose")], { env: { PULSE_CLI_AUTH: "bearer" } })
    expect(explanation(expectError(viaEnv, "CONFIG", 3))).toContain("PULSE_CLI_TOKEN")
    expect(viaEnv.stderr).not.toMatch(SENT_REQUEST)
  })
}
