import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  type Grant,
  isAccessToken,
  MAX_TOKEN_ANSWER_BYTES,
  requestToken,
  revokeToken,
  TOKEN_TIMEOUT_MS,
  type TokenEndpoint,
} from "../../src/oauth/index.js"
import { jsonAnswer } from "../fake-fetch.js"
import { failureOf, formOf, oauthPlatform, T0, TOKEN_URL } from "./support.js"

const PUBLIC: TokenEndpoint = { url: TOKEN_URL, clientId: "pulse-cli", clientAuth: "none" }
const REFRESH = { type: "refresh_token", refreshToken: "r-1" } as const
const FORM = "application/x-www-form-urlencoded"
const OK = () => jsonAnswer({ access_token: "a", token_type: "Bearer" })

/** The user and password a Basic header carries, as text. */
const basicOf = (header: string | undefined) =>
  new TextDecoder().decode(
    Uint8Array.from(atob((header ?? "").slice(6)), (char) => char.charCodeAt(0)),
  )

describe("a token request", () => {
  it("exchanges a code with its verifier and redirect URI, never following a redirect", async () => {
    const { platform, calls, events } = oauthPlatform([OK()])
    const grant = {
      type: "authorization_code",
      code: "c-1",
      redirectUri: "http://127.0.0.1:5000/callback",
      verifier: "v".repeat(43),
    } as const
    await requestToken(PUBLIC, grant, platform)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ url: TOKEN_URL, method: "POST", redirect: "manual" })
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(calls[0]?.headers).toEqual({ accept: "application/json", "content-type": FORM })
    expect(calls[0]?.body).toBe(
      "grant_type=authorization_code&code=c-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A5000%2Fcallback&code_verifier=vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv&client_id=pulse-cli",
    )
    expect(events).toEqual([
      {
        type: "request",
        method: "POST",
        url: TOKEN_URL,
        headers: { Accept: "application/json", "Content-Type": FORM },
        secretHeaders: [],
      },
      expect.objectContaining({ type: "response", status: 200, statusText: "OK" }),
    ])
  })

  it("authenticates a confidential client with Basic, id and secret form-encoded first", async () => {
    const { platform, calls, events } = oauthPlatform([OK()])
    const endpoint = {
      url: TOKEN_URL,
      clientId: "my client:1",
      clientSecret: "pä ss:w+rd",
      clientAuth: "basic",
    } as const
    await requestToken(endpoint, REFRESH, platform)
    expect(basicOf(calls[0]?.headers.authorization)).toBe("my+client%3A1:p%C3%A4+ss%3Aw%2Brd")
    expect(formOf(calls[0])).toEqual({ grant_type: "refresh_token", refresh_token: "r-1" })
    expect(events[0]).toMatchObject({
      headers: { Accept: "application/json", "Content-Type": FORM, Authorization: "Basic ***" },
      secretHeaders: ["authorization"],
    })
    expect(JSON.stringify(events)).not.toContain("r-1")
  })

  it("round-trips any id and secret through the Basic header", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1 }), fc.string(), async (id, secret) => {
        const { platform, calls } = oauthPlatform([OK()])
        const endpoint = { url: TOKEN_URL, clientId: id, clientSecret: secret, clientAuth: "basic" }
        await requestToken(endpoint as TokenEndpoint, REFRESH, platform)
        const [encodedId = "", ...rest] = basicOf(calls[0]?.headers.authorization).split(":")
        const parse = (text: string) => new URLSearchParams(`x=${text}`).get("x")
        expect([parse(encodedId), parse(rest.join(":"))]).toEqual([id, secret])
      }),
      { numRuns: 50 },
    )
  })

  it("sends a public client's id in the form, whatever method it names", async () => {
    const { platform, calls } = oauthPlatform([OK()])
    await requestToken({ ...PUBLIC, clientAuth: "basic" }, REFRESH, platform)
    await requestToken({ ...PUBLIC, clientAuth: "post" }, REFRESH, platform)
    for (const call of calls) {
      expect(call.headers.authorization).toBeUndefined()
      expect(formOf(call)).toEqual({
        grant_type: "refresh_token",
        refresh_token: "r-1",
        client_id: "pulse-cli",
      })
    }
  })

  it("masks the client's secret wherever the endpoint quotes it back", async () => {
    const secret = "pä ss:w+rd-1"
    const quoted = [secret, "p%C3%A4+ss%3Aw%2Brd-1"].join(" and ")
    const { platform } = oauthPlatform([
      jsonAnswer({ error: "invalid_client", error_description: quoted }, 401),
    ])
    const endpoint = { ...PUBLIC, clientSecret: secret, clientAuth: "basic" } as const
    const failure = await failureOf(requestToken(endpoint, REFRESH, platform))
    expect(failure.description).toBe("*** and ***")
  })

  const quoting = (secret: string) =>
    oauthPlatform([
      jsonAnswer({ error: "invalid_grant", error_description: `bad ${secret}` }, 400, {
        "x-echo": secret,
      }),
    ])
  const POST = { ...PUBLIC, clientSecret: "s3cr3t-value", clientAuth: "post" } as const
  const CODE: Grant = {
    type: "authorization_code",
    code: "code-value",
    redirectUri: "http://127.0.0.1:5000/callback",
    verifier: "verifier-value",
  }

  it.each([
    ["the client's secret sent by post", POST, REFRESH, "s3cr3t-value"],
    [
      "a refresh token",
      PUBLIC,
      { type: "refresh_token", refreshToken: "refresh-value" },
      "refresh-value",
    ],
    ["a code", PUBLIC, CODE, "code-value"],
    ["a code verifier", PUBLIC, CODE, "verifier-value"],
  ] as const)(
    "masks %s wherever the endpoint quotes it back",
    async (_name, endpoint, grant, secret) => {
      const { platform, events } = quoting(secret)
      const failure = await failureOf(requestToken(endpoint, grant, platform))
      expect(failure.description).toBe("bad ***")
      expect(JSON.stringify(events)).not.toContain(secret)
    },
  )

  it("masks the token it revokes wherever the endpoint quotes it back", async () => {
    const { platform } = quoting("revoked-value")
    const token = { value: "revoked-value", hint: "refresh_token" } as const
    expect((await failureOf(revokeToken(POST, token, platform))).description).toBe("bad ***")
  })

  it.each([
    ["no absolute URL", "login.test/token", "is no absolute URL"],
    ["another scheme", "ftp://login.test/token", "must use http or https"],
    ["a user", "https://user@login.test/token", "carries a user or a password"],
    ["a password", "https://user:pa55word@login.test/token", "carries a user or a password"],
    ["a password alone", "https://:pa55word@login.test/token", "carries a user or a password"],
  ])(
    "refuses an endpoint URL with %s before sending, naming none of it",
    async (_name, url, message) => {
      const { platform, calls, events } = oauthPlatform([OK()])
      const refused = requestToken({ ...PUBLIC, url }, REFRESH, platform)
      await expect(refused).rejects.toThrow(
        new RangeError(`the authorization server URL ${message}`),
      )
      expect(calls).toEqual([])
      expect(events).toEqual([])
    },
  )

  it("sends to an http URL too: the caller decides which hosts may use it", async () => {
    const { platform, calls } = oauthPlatform([OK()])
    const url = "http://127.0.0.1:8080/realms/pulse/protocol/openid-connect/token"
    await requestToken({ ...PUBLIC, url }, REFRESH, platform)
    expect(calls.map((call) => call.url)).toEqual([url])
  })

  it("puts id and secret into the form for client_secret_post", async () => {
    const { platform, calls } = oauthPlatform([OK()])
    const endpoint = { ...PUBLIC, clientSecret: "s:1", clientAuth: "post" } as const
    await requestToken(endpoint, REFRESH, platform)
    expect(calls[0]?.headers.authorization).toBeUndefined()
    expect(formOf(calls[0])).toMatchObject({ client_id: "pulse-cli", client_secret: "s:1" })
  })

  it("sends no secret for a public client, even when one is set", async () => {
    const { platform, calls } = oauthPlatform([OK()])
    await requestToken({ ...PUBLIC, clientSecret: "never" }, REFRESH, platform)
    expect(calls[0]?.headers.authorization).toBeUndefined()
    expect(formOf(calls[0])).toEqual({
      grant_type: "refresh_token",
      refresh_token: "r-1",
      client_id: "pulse-cli",
    })
  })

  it("asks for client credentials with the audience and the scopes, or neither", async () => {
    const { platform, calls } = oauthPlatform([OK()])
    const endpoint = { ...PUBLIC, clientSecret: "s", clientAuth: "post" } as const
    const grant = { type: "client_credentials", audience: "zeebe", scopes: ["read", "more"] }
    await requestToken(endpoint, grant as never, platform)
    await requestToken(endpoint, { type: "client_credentials", scopes: [] }, platform)
    await requestToken(endpoint, { type: "client_credentials" }, platform)
    expect(calls[0]?.body).toBe(
      "grant_type=client_credentials&audience=zeebe&scope=read+more&client_id=pulse-cli&client_secret=s",
    )
    expect([...new URLSearchParams(calls[1]?.body).keys()]).toEqual([
      "grant_type",
      "client_id",
      "client_secret",
    ])
    expect(calls[2]?.body).toBe(calls[1]?.body)
  })

  it("keeps to a deadline and a size cap of its own by default", () => {
    expect(TOKEN_TIMEOUT_MS).toBe(30_000)
    expect(MAX_TOKEN_ANSWER_BYTES).toBe(1024 * 1024)
  })
})

describe("a token answer", () => {
  const recordOf = async (answer: unknown) => {
    const { platform } = oauthPlatform([jsonAnswer(answer)])
    return requestToken(PUBLIC, REFRESH, platform)
  }

  it("becomes a record with its lifetimes counted from the receipt", async () => {
    await expect(
      recordOf({
        access_token: "eyJ.a-b_c~d+e/f==",
        token_type: "bearer",
        expires_in: 300,
        refresh_token: "r",
        refresh_expires_in: "1800.25",
        scope: "openid offline_access",
        id_token: "x.y.z",
      }),
    ).resolves.toEqual({
      accessToken: "eyJ.a-b_c~d+e/f==",
      receivedAt: T0,
      expiresAt: T0 + 300_000,
      refreshToken: "r",
      refreshExpiresAt: T0 + 1_800_250,
      scope: "openid offline_access",
      idToken: "x.y.z",
    })
  })

  it("takes a missing type, a lifetime as digits and leaves out what is missing or empty", async () => {
    await expect(
      recordOf({ access_token: "a", expires_in: "60", refresh_token: "", scope: "" }),
    ).resolves.toEqual({ accessToken: "a", receivedAt: T0, expiresAt: T0 + 60_000, scope: "" })
  })

  it.each([0, -5, "0", "soon", null, "1e3", true, "9".repeat(400), "-60", ".5", [60], ["60"]])(
    "reads the lifetime %j as unknown",
    async (value) => {
      const record = await recordOf({
        access_token: "a",
        expires_in: value,
        refresh_expires_in: value,
      })
      expect(record).toEqual({ accessToken: "a", receivedAt: T0 })
    },
  )

  it.each([
    ["no JSON object", "<html>", "not-json"],
    ["a list", ["a"], "not-json"],
    ["null", null, "not-json"],
    ["a JSON string", '"token"', "not-json"],
    ["a JSON number", "42", "not-json"],
    ["no token", { token_type: "Bearer" }, "no-token"],
    ["an empty token", { access_token: "" }, "no-token"],
    ["a token that is no string", { access_token: 42 }, "no-token"],
    ["a token with a space", { access_token: "has space" }, "token-syntax"],
    ["a token above ASCII", { access_token: "ä" }, "token-syntax"],
    ["a token with a line break", { access_token: "a\nb" }, "token-syntax"],
  ])("with %s fails as unexpected", async (_name, body, problem) => {
    const { platform } = oauthPlatform([
      typeof body === "string" ? new Response(body) : jsonAnswer(body),
    ])
    const failure = await failureOf(requestToken(PUBLIC, REFRESH, platform))
    expect(failure).toMatchObject({ kind: "unexpected", status: 200, statusText: "OK", problem })
    expect(failure.tokenType).toBeUndefined()
    expect(failure.holdMs).toBe(60_000)
  })

  it.each(["DPoP", "mac", 7, null])("refuses the token type %j", async (tokenType) => {
    const failure = await failureOf(recordOf({ access_token: "a", token_type: tokenType }))
    expect(failure).toMatchObject({ kind: "unexpected", problem: "token-type", tokenType })
  })

  it("is a token only when it is an RFC 6750 b64token", () => {
    expect(isAccessToken("a-b_c~d+e/f==")).toBe(true)
    expect(isAccessToken("a=b")).toBe(false)
    expect(isAccessToken(7)).toBe(false)
  })
})
