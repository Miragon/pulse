import { describe, expect, it } from "vitest"
import type { C8Words } from "@miragon/pulse-c8-core"
import { HttpFailure } from "@miragon/pulse-http"
import { TokenFailure } from "@miragon/pulse-http/oauth"
import { c8WordsOf } from "./c8-errors.js"
import { json, refused, TOKEN_ENDPOINT } from "./test-support/c8-platform.js"
import {
  AGAIN_IN_A_MINUTE,
  CLIENT,
  CLIENT_HINT,
  describeEngine,
  ENDPOINT_HINT,
  IN_FIVE_SECONDS,
  NEVER,
  REQUEST_HINT,
  runtimeOver,
} from "./test-support/c8-words.js"

/**
 * What the model reads when the token endpoint of a Camunda 8 engine gives no token: each trouble
 * of the client credentials grant in the server's words (c8-errors.ts), with the profile's keys and
 * when the server asks again, never the token endpoint's URL, the cluster's url or the secret.
 */

describe("the token endpoint's failures, as the model reads them", () => {
  it("names the profile's keys and when the server asks again, never a URL or the secret", async () => {
    expect(
      await describeEngine(
        { "POST /realms/pulse/token": () => json({ error: "invalid_client" }, 401) },
        CLIENT,
      ),
    ).toEqual({
      failure: "unauthorized",
      message: "the token endpoint refused the client: invalid_client (engine c8)",
      hint:
        "Check auth.clientId in the engine's profile and the secret in the ENGINE_SECRET_* " +
        `variable its auth.clientSecretEnv names; the server reads both at its start. ${AGAIN_IN_A_MINUTE}`,
    })
    expect(await describeEngine({ "POST /realms/pulse/token": refused }, CLIENT)).toEqual({
      failure: "unreachable",
      message: "the token endpoint cannot be reached (engine c8)",
      hint: "The server asks the token endpoint again 5 seconds after its last answer.",
    })
  })

  it("names an unusable token endpoint URL by its key, nothing sent", async () => {
    expect(await describeEngine({}, { ...CLIENT, tokenEndpoint: "login.c8.test/token" })).toEqual({
      failure: "misconfigured",
      message:
        "the token endpoint cannot be used (the authorization server URL is no absolute URL); " +
        "nothing was sent (engine c8)",
      hint: "auth.tokenEndpoint in the engine's profile must be the URL that issues tokens.",
    })
  })

  const words = (failure: TokenFailure): C8Words => {
    const { connection } = runtimeOver({}, CLIENT)
    const said = c8WordsOf(connection)(failure, "unauthorized")
    for (const text of NEVER) expect(`${said.message}\n${said.hint ?? ""}`).not.toMatch(text)
    return said
  }
  const tooLarge = (limit?: number) =>
    new TokenFailure(
      "too-large",
      { url: TOKEN_ENDPOINT, status: 200 },
      new HttpFailure("too-large", {
        method: "POST",
        target: TOKEN_ENDPOINT,
        mayHaveApplied: false,
        limit,
      }),
    )

  it.each<[string, TokenFailure, string, string]>([
    [
      "scope",
      new TokenFailure("scope", { url: TOKEN_ENDPOINT, status: 400, error: "invalid_scope" }),
      "the token endpoint refused the token request: invalid_scope (engine c8)",
      `${REQUEST_HINT} ${AGAIN_IN_A_MINUTE}`,
    ],
    [
      "grant without a code",
      new TokenFailure("grant", { url: TOKEN_ENDPOINT, status: 400 }),
      "the token endpoint refused the token request: HTTP 400 (engine c8)",
      `${REQUEST_HINT} ${AGAIN_IN_A_MINUTE}`,
    ],
    [
      "client without a status",
      new TokenFailure("client", { url: TOKEN_ENDPOINT }),
      "the token endpoint refused the client: HTTP 401 (engine c8)",
      `${CLIENT_HINT} ${AGAIN_IN_A_MINUTE}`,
    ],
    [
      "forbidden",
      new TokenFailure("forbidden", { url: TOKEN_ENDPOINT, status: 403 }),
      "the token endpoint refused to issue a token to the client: HTTP 403 (engine c8)",
      "Check that the token endpoint lets this client get a token for the audience and the " +
        `scopes in the engine's profile. ${AGAIN_IN_A_MINUTE}`,
    ],
    [
      "rate-limited",
      new TokenFailure("rate-limited", { url: TOKEN_ENDPOINT, status: 429, holdMs: 30_000 }),
      "the token endpoint limits the token requests: HTTP 429 (engine c8)",
      "The server asks the token endpoint again 30 seconds after its last answer.",
    ],
    [
      "unavailable",
      new TokenFailure("unavailable", { url: TOKEN_ENDPOINT, status: 503 }),
      "the token endpoint failed with HTTP 503 (engine c8)",
      IN_FIVE_SECONDS,
    ],
    [
      "unavailable without a status",
      new TokenFailure("unavailable", { url: TOKEN_ENDPOINT }),
      "the token endpoint cannot answer now (engine c8)",
      IN_FIVE_SECONDS,
    ],
    [
      "redirect",
      new TokenFailure("redirect", { url: TOKEN_ENDPOINT, status: 302 }),
      "the token endpoint answered with a redirect (engine c8)",
      `${ENDPOINT_HINT} ${AGAIN_IN_A_MINUTE}`,
    ],
    [
      "too-large",
      tooLarge(1024 * 1024),
      "the token endpoint answered with more than 1 MiB (engine c8)",
      AGAIN_IN_A_MINUTE,
    ],
    [
      "too-large in bytes",
      tooLarge(1000),
      "the token endpoint answered with more than 1000 bytes (engine c8)",
      AGAIN_IN_A_MINUTE,
    ],
    [
      "too-large without a cap",
      tooLarge(),
      "the token endpoint answered with more than the server accepts (engine c8)",
      AGAIN_IN_A_MINUTE,
    ],
    [
      "unexpected status",
      new TokenFailure("unexpected", { url: TOKEN_ENDPOINT, status: 418 }),
      "the token endpoint answered with HTTP 418 (engine c8)",
      `${ENDPOINT_HINT} ${AGAIN_IN_A_MINUTE}`,
    ],
    [
      "unexpected without a status",
      new TokenFailure("unexpected", { url: TOKEN_ENDPOINT }),
      "the token endpoint answered with HTTP 0 (engine c8)",
      `${ENDPOINT_HINT} ${AGAIN_IN_A_MINUTE}`,
    ],
    [
      "unexpected without a token",
      new TokenFailure("unexpected", { url: TOKEN_ENDPOINT, status: 200, problem: "no-token" }),
      "the token endpoint answered without a token (engine c8)",
      AGAIN_IN_A_MINUTE,
    ],
    [
      "unexpected not JSON",
      new TokenFailure("unexpected", { url: TOKEN_ENDPOINT, status: 200, problem: "not-json" }),
      "the token endpoint answered without a token (engine c8)",
      AGAIN_IN_A_MINUTE,
    ],
    [
      "unexpected token syntax",
      new TokenFailure("unexpected", { url: TOKEN_ENDPOINT, status: 200, problem: "token-syntax" }),
      "the token endpoint answered with a token outside the Bearer token syntax (RFC 6750) (engine c8)",
      AGAIN_IN_A_MINUTE,
    ],
    [
      "unexpected token type",
      new TokenFailure("unexpected", { url: TOKEN_ENDPOINT, status: 200, problem: "token-type" }),
      "the token endpoint answered with a token of another type than Bearer (engine c8)",
      AGAIN_IN_A_MINUTE,
    ],
    [
      "timeout",
      new TokenFailure("timeout", { url: TOKEN_ENDPOINT }),
      "the token endpoint did not answer in time (engine c8)",
      IN_FIVE_SECONDS,
    ],
    [
      "expired",
      new TokenFailure("expired", {}),
      "the token expired, and the token endpoint gave no new one (engine c8)",
      AGAIN_IN_A_MINUTE,
    ],
  ])("words %s", (_name, failure, message, hint) => {
    expect(words(failure)).toEqual({ message, hint })
  })

  it.each<[number, string]>([
    [400, "a second"],
    [1_000, "a second"],
    [30_000, "30 seconds"],
    [60_000, "a minute"],
    [119_000, "119 seconds"],
    [150_000, "about 3 minutes"],
    [180_000, "3 minutes"],
  ])("says a hold of %i ms as %s", (holdMs, wait) => {
    const failure = new TokenFailure("rate-limited", { url: TOKEN_ENDPOINT, status: 429, holdMs })
    expect(words(failure).hint).toBe(
      `The server asks the token endpoint again ${wait} after its last answer.`,
    )
  })
})
