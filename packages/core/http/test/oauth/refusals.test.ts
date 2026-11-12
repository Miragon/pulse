import { describe, expect, it } from "vitest"
import { HttpFailure } from "../../src/index.js"
import {
  requestToken,
  revokeToken,
  type TokenEndpoint,
  TokenFailure,
} from "../../src/oauth/index.js"
import { failWith, jsonAnswer, networkError, untilAborted } from "../fake-fetch.js"
import { failureOf, formOf, oauthPlatform, T0, TOKEN_URL } from "./support.js"

const PUBLIC: TokenEndpoint = { url: TOKEN_URL, clientId: "pulse-cli", clientAuth: "none" }
const REFRESH = { type: "refresh_token", refreshToken: "r-1" } as const

async function refusalOf(answer: Response): Promise<TokenFailure> {
  const { platform } = oauthPlatform([answer])
  return failureOf(requestToken(PUBLIC, REFRESH, platform))
}

describe("a refusal of the token endpoint", () => {
  it.each([
    [400, "invalid_client", "client"],
    [401, "unauthorized_client", "client"],
    [400, "unsupported_grant_type", "client"],
    [401, "invalid_scope", "scope"],
    [400, "invalid_grant", "grant"],
    [401, "invalid_grant", "grant"],
    [400, "invalid_request", "grant"],
    [400, "not_allowed", "grant"],
  ])("reads HTTP %i %s by its code", async (status, error, kind) => {
    const failure = await refusalOf(
      jsonAnswer({ error, error_description: "said <b>so</b>" }, status),
    )
    expect(failure).toBeInstanceOf(TokenFailure)
    expect(failure).toMatchObject({
      kind,
      status,
      error,
      description: "said <b>so</b>",
      code: error,
      holdMs: 60_000,
    })
  })

  it.each([
    [401, {}, "client"],
    [401, { error: "" }, "client"],
    [400, {}, "unexpected"],
    [400, { error: "" }, "unexpected"],
    [400, { error: 7 }, "unexpected"],
    [403, { error: "invalid_client" }, "forbidden"],
    [404, { error: "invalid_client" }, "unexpected"],
    [410, {}, "unexpected"],
    [201, {}, "unexpected"],
  ])("reads HTTP %i %j by its status", async (status, body, kind) => {
    const failure = await refusalOf(jsonAnswer(body, status))
    expect(failure.kind).toBe(kind)
    expect(failure.problem).toBeUndefined()
  })

  it("keeps the code of an error reduced to its characters, the error as sent", async () => {
    const failure = await refusalOf(jsonAnswer({ error: "invalid_scope\u001b[31m <b>" }, 400))
    expect(failure).toMatchObject({
      kind: "grant",
      error: "invalid_scope\u001b[31m <b>",
      code: "invalid_scope31mb",
    })
    expect(failure.description).toBeUndefined()
    expect(failure.message).toBe("no token: grant (HTTP 400) (invalid_scope31mb)")
  })

  it.each([300, 302, 307])("reads a %i as a redirect, its body unread", async (status) => {
    const failure = await refusalOf(
      new Response("", { status, headers: { Location: "https://elsewhere.test" } }),
    )
    expect(failure).toMatchObject({ kind: "redirect", status, holdMs: 60_000 })
    if (status !== 300) {
      expect(failure.statusText).toBe(status === 302 ? "Found" : "Temporary Redirect")
    }
  })

  it.each([408, 425, 500, 502, 503, 504])(
    "reads HTTP %i as unavailable for five seconds",
    async (status) => {
      expect(await refusalOf(new Response(null, { status }))).toMatchObject({
        kind: "unavailable",
        holdMs: 5_000,
      })
    },
  )

  it("holds a rate limit as its Retry-After asks, else a minute", async () => {
    const asked = await refusalOf(
      new Response("", { status: 429, headers: { "Retry-After": "120" } }),
    )
    expect(asked).toMatchObject({ kind: "rate-limited", holdMs: 120_000 })
    const at = new Date(T0 + 7_000).toUTCString()
    const dated = await refusalOf(new Response("", { status: 429, headers: { "Retry-After": at } }))
    expect(dated.holdMs).toBeGreaterThan(0)
    expect(await refusalOf(new Response("", { status: 429 }))).toMatchObject({ holdMs: 60_000 })
  })
})

describe("a token request without an answer", () => {
  it("is unreachable when no connection comes up, with the transport's failure as cause", async () => {
    const { platform } = oauthPlatform([failWith(networkError("ECONNREFUSED"))])
    const failure = await failureOf(requestToken(PUBLIC, REFRESH, platform))
    expect(failure).toMatchObject({ kind: "unreachable", holdMs: 5_000, url: TOKEN_URL })
    expect(failure.cause).toBeInstanceOf(HttpFailure)
    expect((failure.cause as HttpFailure).code).toBe("ECONNREFUSED")
  })

  it("is unreachable when the answer breaks off", async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new TypeError("terminated"))
          },
        }),
      )
    const { platform } = oauthPlatform([broken])
    expect((await failureOf(requestToken(PUBLIC, REFRESH, platform))).kind).toBe("unreachable")
  })

  it("times out at its deadline", async () => {
    const { platform } = oauthPlatform([untilAborted])
    const failure = await failureOf(requestToken(PUBLIC, REFRESH, platform, { timeoutMs: 20 }))
    expect(failure).toMatchObject({ kind: "timeout", holdMs: 5_000 })
    expect((failure.cause as HttpFailure).reason).toBe("deadline")
  })

  it("fails as too large for a success above the cap, reads a refusal by its status", async () => {
    const big = { access_token: "a", padding: "x".repeat(100) }
    const { platform } = oauthPlatform([
      jsonAnswer(big),
      jsonAnswer(big, 401),
      jsonAnswer({ error: "invalid_grant", padding: big.padding }, 400),
    ])
    const limits = { maxAnswerBytes: 64 }
    const tooLarge = await failureOf(requestToken(PUBLIC, REFRESH, platform, limits))
    expect(tooLarge).toMatchObject({ kind: "too-large", status: 200, statusText: "OK" })
    expect(tooLarge.url).toBe(TOKEN_URL)
    const refused = await failureOf(requestToken(PUBLIC, REFRESH, platform, limits))
    expect(refused).toMatchObject({ kind: "client", status: 401 })
    expect(refused.error).toBeUndefined()
    const unread = await failureOf(requestToken(PUBLIC, REFRESH, platform, limits))
    expect(unread).toMatchObject({ kind: "unexpected", status: 400, statusText: "Bad Request" })
  })
})

describe("a revocation", () => {
  it("revokes with a token type hint and the client's authentication", async () => {
    const { platform, calls } = oauthPlatform([new Response(null, { status: 200 })])
    await expect(
      revokeToken(PUBLIC, { value: "r-1", hint: "refresh_token" }, platform),
    ).resolves.toBeUndefined()
    expect(calls[0]).toMatchObject({ url: TOKEN_URL, method: "POST" })
    expect(formOf(calls[0])).toEqual({
      token: "r-1",
      token_type_hint: "refresh_token",
      client_id: "pulse-cli",
    })
  })

  it("fails with what the endpoint said", async () => {
    const { platform } = oauthPlatform([
      jsonAnswer({ error: "unsupported_token_type", error_description: "nope" }, 400),
    ])
    const failure = await failureOf(
      revokeToken(PUBLIC, { value: "a", hint: "access_token" }, platform, { timeoutMs: 1000 }),
    )
    expect(failure).toMatchObject({
      kind: "grant",
      status: 400,
      statusText: "Bad Request",
      error: "unsupported_token_type",
      description: "nope",
    })
  })
})
