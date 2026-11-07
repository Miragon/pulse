import { describe, expect, test } from "vitest"
import { C8Adapter } from "../../../src/adapters/c8/index.js"
import type {
  EngineCredentials,
  ProcessRuntime,
  RuntimeError,
} from "../../../src/contract/index.js"
import { jsonAnswer, problem, REST_URL } from "./support/fake-camunda-rest.js"

const TOKEN_URL = "https://login.test/oauth/token"
const CREDENTIALS: EngineCredentials = {
  kind: "clientCredentials",
  tokenEndpoint: TOKEN_URL,
  clientId: "pulse",
  clientSecret: "s3cret",
  audience: "zeebe.camunda.io",
  scopes: ["read", "more"],
}
const LIFETIME_S = 3600
const STEP_BACK_MS = 10 * 60 * 1000
const TOKEN_TEXT = "eyJhbGciOi.secret-part"
const OUTSIDE_THE_SYNTAX =
  "The token endpoint answered with a token outside the Bearer token syntax (RFC 6750)."

type TokenAnswer = (form: URLSearchParams) => Response

class Login {
  now = 1_000_000

  tokenBodies: string[] = []

  tokenRedirects: string[] = []

  apiAuthorizations: (string | null)[] = []

  answerToken: TokenAnswer = () =>
    jsonAnswer({ access_token: `token-${this.tokenBodies.length}`, expires_in: LIFETIME_S })

  answerApi: (authorization: string | null) => Response = () =>
    jsonAnswer({ gatewayVersion: "8.10.8" })

  readonly send: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.url === TOKEN_URL) {
      const body = await request.text()
      this.tokenBodies.push(body)
      this.tokenRedirects.push(request.redirect)
      return this.answerToken(new URLSearchParams(body))
    }
    const authorization = request.headers.get("Authorization")
    this.apiAuthorizations.push(authorization)
    return this.answerApi(authorization)
  }

  readonly adapter = new C8Adapter(this.send, () => this.now)

  runtime(credentials: EngineCredentials = CREDENTIALS): ProcessRuntime {
    return this.adapter.runtime({ endpoint: REST_URL, credentials })
  }
}

function failureOf(attempt: Promise<unknown>): Promise<unknown> {
  return attempt.then(
    () => "answered",
    (error: unknown) => error,
  )
}

describe("client credentials", () => {
  test("ask for a token with the client, the audience and the scopes, never following a redirect", async () => {
    const login = new Login()

    await login.runtime().describeEngine()

    const form = new URLSearchParams(login.tokenBodies[0])
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "client_credentials",
      client_id: "pulse",
      client_secret: "s3cret",
      audience: "zeebe.camunda.io",
      scope: "read more",
    })
    expect(login.tokenRedirects).toEqual(["manual"])
    expect(login.apiAuthorizations).toEqual(["Bearer token-1"])
  })

  test("send neither audience nor scope when the profile names none", async () => {
    const login = new Login()

    await login
      .runtime({
        kind: "clientCredentials",
        tokenEndpoint: TOKEN_URL,
        clientId: "pulse",
        clientSecret: "s3cret",
        scopes: [],
      })
      .describeEngine()

    expect([...new URLSearchParams(login.tokenBodies[0]).keys()]).toEqual([
      "grant_type",
      "client_id",
      "client_secret",
    ])
  })

  test("send a token with every character the Bearer token syntax allows as it came", async () => {
    const login = new Login()
    login.answerToken = () =>
      jsonAnswer({ access_token: "eyJ0-9_A.z~Z+a/b==", expires_in: LIFETIME_S })

    await login.runtime().describeEngine()

    expect(login.apiAuthorizations).toEqual(["Bearer eyJ0-9_A.z~Z+a/b=="])
  })

  test("ask once for parallel reads and across connection rebuilds", async () => {
    const login = new Login()

    await Promise.all([login.runtime().describeEngine(), login.runtime().describeEngine()])
    await login.runtime().describeEngine()

    expect(login.tokenBodies).toHaveLength(1)
  })

  test("ask again shortly before the token expires, not earlier", async () => {
    const login = new Login()
    await login.runtime().describeEngine()

    login.now += (LIFETIME_S - 90) * 1000
    await login.runtime().describeEngine()
    expect(login.tokenBodies).toHaveLength(1)

    login.now += 60 * 1000
    await login.runtime().describeEngine()
    expect(login.tokenBodies).toHaveLength(2)
  })

  test("take a tenth of a short lifetime as the margin", async () => {
    const login = new Login()
    login.answerToken = () => jsonAnswer({ access_token: "short", expires_in: 5 })
    await login.runtime().describeEngine()

    login.now += 4000
    await login.runtime().describeEngine()
    expect(login.tokenBodies).toHaveLength(1)

    login.now += 1000
    await login.runtime().describeEngine()
    expect(login.tokenBodies).toHaveLength(2)
  })

  test("assume a lifetime when the answer names none", async () => {
    const login = new Login()
    login.answerToken = () => jsonAnswer({ access_token: "plain" })
    await login.runtime().describeEngine()

    login.now += 200 * 1000
    await login.runtime().describeEngine()

    expect(login.tokenBodies).toHaveLength(1)
  })

  test("ask anew once the secret changed", async () => {
    const login = new Login()
    await login.runtime().describeEngine()

    await login.runtime({ ...CREDENTIALS, clientSecret: "rotated" }).describeEngine()
    await login.runtime({ ...CREDENTIALS, clientSecret: "rotated" }).describeEngine()

    expect(login.tokenBodies).toHaveLength(2)
  })

  test("keep a token per secret, so two profiles of one client keep their token and their hold across rebuilds", async () => {
    const login = new Login()
    const stale = { ...CREDENTIALS, clientSecret: "stale" }
    login.answerToken = (form) =>
      form.get("client_secret") === "stale"
        ? jsonAnswer({ error: "invalid_client" }, 401)
        : jsonAnswer({ access_token: `token-${login.tokenBodies.length}`, expires_in: LIFETIME_S })

    for (let rebuild = 0; rebuild < 5; rebuild += 1) {
      login.now += 1000
      await login.runtime().describeEngine()
      expect(await failureOf(login.runtime(stale).describeEngine())).toMatchObject({
        failure: "unauthorized",
      })
    }

    expect(login.tokenBodies).toHaveLength(2)
    expect(new Set(login.apiAuthorizations)).toEqual(new Set(["Bearer token-1"]))
  })

  test.each([[0], [-60], ["0"], ["-60"], ["1e3"], ["soon"], [null], [true]])(
    "assume the default lifetime when expires_in is %j, so no read asks again at once",
    async (expiresIn) => {
      const login = new Login()
      login.answerToken = () =>
        jsonAnswer({ access_token: `token-${login.tokenBodies.length}`, expires_in: expiresIn })

      await login.runtime().describeEngine()
      await login.runtime().describeEngine()
      login.now += 269 * 1000
      await login.runtime().describeEngine()
      expect(login.tokenBodies).toHaveLength(1)

      login.now += 2 * 1000
      await login.runtime().describeEngine()
      expect(login.tokenBodies).toHaveLength(2)
    },
  )

  test.each([
    ["300", 270],
    ["1200", 1140],
  ])("read expires_in %j as seconds", async (expiresIn, refreshS) => {
    const login = new Login()
    login.answerToken = () =>
      jsonAnswer({ access_token: `token-${login.tokenBodies.length}`, expires_in: expiresIn })
    await login.runtime().describeEngine()

    login.now += (refreshS - 1) * 1000
    await login.runtime().describeEngine()
    expect(login.tokenBodies).toHaveLength(1)

    login.now += 2 * 1000
    await login.runtime().describeEngine()
    expect(login.tokenBodies).toHaveLength(2)
  })
})

describe("a refused token request", () => {
  test("stops: it reads as unauthorized without the secret and is not repeated", async () => {
    const login = new Login()
    login.answerToken = () => jsonAnswer({ error: "unauthorized_client" }, 401)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const error = await failureOf(login.runtime().listDefinitions())
      expect(error).toMatchObject({ failure: "unauthorized" })
      expect((error as Error).message).not.toContain("s3cret")
    }

    expect(login.tokenBodies).toHaveLength(1)
    expect(login.apiAuthorizations).toEqual([])
  })

  test("is tried again a minute later", async () => {
    const login = new Login()
    login.answerToken = () => jsonAnswer({ error: "unauthorized_client" }, 401)
    await failureOf(login.runtime().listDefinitions())

    login.now += 61 * 1000
    login.answerToken = () => jsonAnswer({ access_token: "fixed", expires_in: LIFETIME_S })

    expect(await login.runtime().describeEngine()).toMatchObject({ version: "8.10.8" })
    expect(login.tokenBodies).toHaveLength(2)
  })

  test("is tried again at once with another secret", async () => {
    const login = new Login()
    login.answerToken = () => jsonAnswer({ error: "unauthorized_client" }, 401)
    await failureOf(login.runtime().listDefinitions())

    login.answerToken = () => jsonAnswer({ access_token: "fixed", expires_in: LIFETIME_S })

    await login.runtime({ ...CREDENTIALS, clientSecret: "rotated" }).describeEngine()
    expect(login.tokenBodies).toHaveLength(2)
  })

  test("honours the wait a rate limit asks for and does not read as a credentials problem", async () => {
    const login = new Login()
    login.answerToken = () => new Response("", { status: 429, headers: { "Retry-After": "120" } })

    expect(await failureOf(login.runtime().describeEngine())).toMatchObject({
      failure: "engineFailure",
    })

    login.now += 100 * 1000
    await failureOf(login.runtime().describeEngine())
    expect(login.tokenBodies).toHaveLength(1)

    login.now += 21 * 1000
    await failureOf(login.runtime().describeEngine())
    expect(login.tokenBodies).toHaveLength(2)
  })

  test("waits a minute after a rate limit that names no wait", async () => {
    const login = new Login()
    login.answerToken = () => new Response("", { status: 429 })
    await failureOf(login.runtime().describeEngine())

    login.now += 59 * 1000
    await failureOf(login.runtime().describeEngine())
    expect(login.tokenBodies).toHaveLength(1)

    login.now += 2 * 1000
    await failureOf(login.runtime().describeEngine())
    expect(login.tokenBodies).toHaveLength(2)
  })

  test("reads a failing login service as unreachable and tries again soon", async () => {
    const login = new Login()
    login.answerToken = () => new Response("", { status: 503 })
    expect(await failureOf(login.runtime().describeEngine())).toMatchObject({
      failure: "unreachable",
    })

    login.now += 6 * 1000
    await failureOf(login.runtime().describeEngine())
    expect(login.tokenBodies).toHaveLength(2)
  })

  test("reads a login service that cannot be reached as unreachable", async () => {
    let calls = 0
    const send: typeof fetch = () => {
      calls += 1
      return Promise.reject(new TypeError("fetch failed"))
    }
    const runtime = new C8Adapter(send, () => 0).runtime({
      endpoint: REST_URL,
      credentials: CREDENTIALS,
    })

    expect(await failureOf(runtime.describeEngine())).toMatchObject({ failure: "unreachable" })
    await failureOf(runtime.describeEngine())
    expect(calls).toBe(1)
  })

  test("reads a redirect as a wrong token endpoint", async () => {
    const login = new Login()
    login.answerToken = () =>
      new Response("", { status: 302, headers: { Location: "https://elsewhere.test" } })

    expect(await failureOf(login.runtime().describeEngine())).toMatchObject({
      failure: "misconfigured",
    })
  })

  test.each([
    ["no token", () => jsonAnswer({ token_type: "Bearer" })],
    ["an empty token", () => jsonAnswer({ access_token: "" })],
    ["no JSON", () => new Response("<html>")],
    ["null", () => jsonAnswer(null)],
  ])("reads an answer with %s as unexpected", async (_name, answer) => {
    const login = new Login()
    login.answerToken = answer

    expect(await failureOf(login.runtime().describeEngine())).toMatchObject({
      failure: "unexpectedResponse",
    })
  })
})

describe("a token outside the Bearer token syntax", () => {
  test.each([
    ["a line feed", `${TOKEN_TEXT}\nX`],
    ["a carriage return", `${TOKEN_TEXT}\rX`],
    ["a CRLF", `${TOKEN_TEXT}\r\nX`],
    ["a NUL", `${TOKEN_TEXT}\u0000X`],
    ["a trailing line feed", `${TOKEN_TEXT}\n`],
    ["a space", `${TOKEN_TEXT} X`],
    ["a character above Latin-1", `${TOKEN_TEXT}${String.fromCharCode(0x100)}`],
  ])("with %s is refused unquoted, and the API gets no request", async (_name, accessToken) => {
    const login = new Login()
    login.answerToken = () => jsonAnswer({ access_token: accessToken, expires_in: LIFETIME_S })

    const error = (await failureOf(login.runtime().describeEngine())) as RuntimeError

    expect(error).toMatchObject({ failure: "unexpectedResponse", message: OUTSIDE_THE_SYNTAX })
    expect(`${error.message} ${String(error.hint)}`).not.toContain(TOKEN_TEXT)
    expect(login.apiAuthorizations).toEqual([])
  })

  test("is held for a minute like any refusal", async () => {
    const login = new Login()
    login.answerToken = () =>
      jsonAnswer({ access_token: `${TOKEN_TEXT}\nX`, expires_in: LIFETIME_S })
    await failureOf(login.runtime().describeEngine())

    login.now += 59 * 1000
    expect(await failureOf(login.runtime().describeEngine())).toMatchObject({
      message: OUTSIDE_THE_SYNTAX,
    })
    expect(login.tokenBodies).toHaveLength(1)

    login.now += 2 * 1000
    await failureOf(login.runtime().describeEngine())
    expect(login.tokenBodies).toHaveLength(2)
  })
})

describe("an API that rejects a token", () => {
  test("gets one fresh token when the token is old enough to have gone stale", async () => {
    const login = new Login()
    await login.runtime().describeEngine()
    login.now += 60 * 1000
    login.answerApi = (authorization) =>
      authorization === "Bearer token-1"
        ? problem(401, "Unauthorized", "expired")
        : jsonAnswer({ gatewayVersion: "8.10.8", items: [], page: { totalItems: 0 } })

    await login.runtime().describeEngine()

    expect(login.tokenBodies).toHaveLength(2)
    expect(login.apiAuthorizations).toEqual(["Bearer token-1", "Bearer token-1", "Bearer token-2"])
  })

  test("keeps a token it just got and reads as unauthorized, so a wrong audience costs no token per read", async () => {
    const login = new Login()
    login.answerApi = () => problem(401, "Unauthorized", "wrong audience")

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await failureOf(login.runtime().describeEngine())).toMatchObject({
        failure: "unauthorized",
      })
    }

    expect(login.tokenBodies).toHaveLength(1)
  })

  test("retries with the token another read already fetched", async () => {
    const login = new Login()
    await login.runtime().describeEngine()
    login.now += 60 * 1000
    let rejected = 0
    login.answerApi = (authorization) => {
      if (authorization === "Bearer token-1") {
        rejected += 1
        return problem(401, "Unauthorized", "expired")
      }
      return jsonAnswer({ gatewayVersion: "8.10.8" })
    }

    await Promise.all([login.runtime().describeEngine(), login.runtime().describeEngine()])

    expect(rejected).toBeGreaterThan(0)
    expect(login.tokenBodies).toHaveLength(2)
  })

  test("does not retry with basic credentials", async () => {
    const login = new Login()
    login.answerApi = () => problem(401, "Unauthorized", "wrong password")

    await failureOf(
      login.runtime({ kind: "basic", username: "demo", password: "wrong" }).describeEngine(),
    )

    expect(login.apiAuthorizations).toHaveLength(1)
  })
})

describe("a clock that steps back", () => {
  test("asks for a new token once the clock is behind the token, then keeps that one", async () => {
    const login = new Login()
    await login.runtime().describeEngine()

    login.now -= STEP_BACK_MS
    await login.runtime().describeEngine()
    await login.runtime().describeEngine()

    expect(login.tokenBodies).toHaveLength(2)
    expect(login.apiAuthorizations).toEqual(["Bearer token-1", "Bearer token-2", "Bearer token-2"])
  })

  test("gets a fresh token after a 401 when the clock stepped back during the read", async () => {
    const login = new Login()
    login.answerApi = (authorization) => {
      if (authorization === "Bearer token-1") {
        login.now -= STEP_BACK_MS
        return problem(401, "Unauthorized", "expired")
      }
      return jsonAnswer({ gatewayVersion: "8.10.8" })
    }

    expect(await login.runtime().describeEngine()).toMatchObject({ version: "8.10.8" })
    expect(login.apiAuthorizations).toEqual(["Bearer token-1", "Bearer token-2"])
  })

  test.each([
    ["a refusal", () => jsonAnswer({ error: "invalid_client" }, 401)],
    ["a rate limit", () => new Response("", { status: 429, headers: { "Retry-After": "3600" } })],
    ["a failing login service", () => new Response("", { status: 503 })],
  ])("ends the hold of %s that began after the clock's new time", async (_name, answer) => {
    const login = new Login()
    login.answerToken = answer
    await failureOf(login.runtime().describeEngine())

    login.now -= STEP_BACK_MS
    login.answerToken = () => jsonAnswer({ access_token: "fixed", expires_in: LIFETIME_S })

    expect(await login.runtime().describeEngine()).toMatchObject({ version: "8.10.8" })
    expect(login.tokenBodies).toHaveLength(2)
  })
})
