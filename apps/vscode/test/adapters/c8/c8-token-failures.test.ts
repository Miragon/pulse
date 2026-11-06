import { describe, expect, test } from "vitest"
import { C8Adapter } from "../../../src/adapters/c8/index.js"
import type { EngineCredentials, RuntimeError } from "../../../src/contract/index.js"
import { jsonAnswer, REST_URL } from "./support/fake-camunda-rest.js"

const TOKEN_URL = "https://login.test/oauth/token"
const SECRET = "s3cret"
const CREDENTIALS: EngineCredentials = {
  kind: "clientCredentials",
  tokenEndpoint: TOKEN_URL,
  clientId: "pulse",
  clientSecret: SECRET,
}
const MEBIBYTE = 1024 * 1024
const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const ENDPOINT_HINT = "The profile's tokenEndpoint must be the URL that issues tokens."
const REQUEST_HINT =
  "Check the audience and the scopes in the profile. Pulse sends them as written."

class TokenEndpoint {
  now = 1_000_000

  requests = 0

  answer: () => Response = () => jsonAnswer({ access_token: "token", expires_in: 3600 })

  private readonly adapter = new C8Adapter(
    (input, init) => this.answered(new Request(input, init)),
    () => this.now,
  )

  read(): Promise<unknown> {
    return this.adapter
      .runtime({ endpoint: REST_URL, credentials: CREDENTIALS })
      .describeEngine()
      .then(
        () => "answered",
        (error: unknown) => error,
      )
  }

  async asksAgainAfter(waitMs: number): Promise<boolean> {
    const before = this.requests
    this.now += waitMs
    await this.read()
    return this.requests > before
  }

  private answered(request: Request): Promise<Response> {
    if (request.url !== TOKEN_URL) {
      return Promise.resolve(jsonAnswer({ gatewayVersion: "8.10.8" }))
    }
    this.requests += 1
    return Promise.resolve(this.answer())
  }
}

function endpointAnswering(answer: () => Response): TokenEndpoint {
  const endpoint = new TokenEndpoint()
  endpoint.answer = answer
  return endpoint
}

function streamOf(sizes: readonly number[]): ReadableStream<Uint8Array> {
  const left = [...sizes]
  return new ReadableStream({
    pull(controller) {
      const size = left.shift()
      if (size === undefined) {
        controller.close()
      } else {
        controller.enqueue(new Uint8Array(size).fill(0x20))
      }
    },
  })
}

describe("a token endpoint that refuses with an error code", () => {
  test.each([
    [400, "invalid_client", "unauthorized"],
    [400, "unauthorized_client", "unauthorized"],
    [401, "invalid_client", "unauthorized"],
    [401, "unauthorized_client", "unauthorized"],
  ])("reads HTTP %i %s as a refused client", async (status, error, failure) => {
    const endpoint = endpointAnswering(() => jsonAnswer({ error }, status))

    expect(await endpoint.read()).toMatchObject({
      failure,
      message: `The token endpoint refused the client ID or secret (${error}).`,
      hint: undefined,
    })
  })

  test.each([
    [400, "invalid_scope"],
    [400, "invalid_target"],
    [400, "invalid_request"],
    [400, "unsupported_grant_type"],
    [401, "invalid_grant"],
    [400, "temporarily_unsupported"],
  ])("reads HTTP %i %s as a request the profile sets up wrong", async (status, error) => {
    const endpoint = endpointAnswering(() => jsonAnswer({ error }, status))

    expect(await endpoint.read()).toMatchObject({
      failure: "misconfigured",
      message: `The token endpoint refused the request (${error}).`,
      hint: REQUEST_HINT,
    })
  })

  test("names the code alone, reduced to its characters, never the description or the body", async () => {
    const endpoint = endpointAnswering(() =>
      jsonAnswer(
        {
          error: "invalid_scope\u001b[31m <b>",
          error_description: `the scope of ${SECRET} is unknown`,
          detail: SECRET,
        },
        400,
      ),
    )

    const error = (await endpoint.read()) as RuntimeError

    expect(error).toMatchObject({
      failure: "misconfigured",
      message: "The token endpoint refused the request (invalid_scope31mb).",
    })
    expect(`${error.message} ${String(error.hint)}`).not.toContain(SECRET)
  })

  test("cuts a code longer than any real one", async () => {
    const endpoint = endpointAnswering(() => jsonAnswer({ error: "x".repeat(100) }, 400))

    expect(await endpoint.read()).toMatchObject({
      message: `The token endpoint refused the request (${"x".repeat(64)}).`,
    })
  })

  test.each([
    ["a code of other characters only", { error: "<>  " }],
    ["an empty code", { error: "" }],
    ["a code that is no string", { error: 7 }],
    ["an answer that is a list", ["invalid_client"]],
  ])("reads %s as no code", async (_name, body) => {
    const endpoint = endpointAnswering(() => jsonAnswer(body, 401))

    expect(await endpoint.read()).toMatchObject({
      failure: "unauthorized",
      message: "The token endpoint refused the client ID or secret (HTTP 401).",
    })
  })
})

describe("a token endpoint that refuses without an error code", () => {
  test.each([400, 404, 405, 410, 422])(
    "reads HTTP %i as misconfigured and names the token endpoint",
    async (status) => {
      const endpoint = endpointAnswering(() => new Response("<html>No token</html>", { status }))

      expect(await endpoint.read()).toMatchObject({
        failure: "misconfigured",
        message: `The token endpoint ${TOKEN_URL} answered with HTTP ${status}.`,
        hint: ENDPOINT_HINT,
      })
    },
  )

  test.each([
    [401, "unauthorized", "The token endpoint refused the client ID or secret (HTTP 401)."],
    [403, "forbidden", "The token endpoint refused to issue a token for this client (HTTP 403)."],
  ])("reads HTTP %i as %s", async (status, failure, message) => {
    const endpoint = endpointAnswering(() => new Response("<html>No token</html>", { status }))

    expect(await endpoint.read()).toMatchObject({ failure, message, hint: undefined })
  })

  test.each([
    [403, "forbidden"],
    [404, "misconfigured"],
  ])("reads HTTP %i by its status even with an error code", async (status, failure) => {
    const endpoint = endpointAnswering(() => jsonAnswer({ error: "invalid_client" }, status))

    expect(await endpoint.read()).toMatchObject({
      failure,
      message: expect.stringContaining(`HTTP ${status}`) as unknown,
    })
  })

  test("reads a redirect as a wrong token endpoint", async () => {
    const endpoint = endpointAnswering(
      () => new Response("", { status: 307, headers: { Location: "https://elsewhere.test" } }),
    )

    expect(await endpoint.read()).toMatchObject({
      failure: "misconfigured",
      message: "The token endpoint answered with a redirect.",
      hint: ENDPOINT_HINT,
    })
  })

  test.each([
    ["an error code", () => jsonAnswer({ error: "invalid_scope" }, 400)],
    ["no error code", () => new Response("", { status: 400 })],
    ["a refused client", () => jsonAnswer({ error: "invalid_client" }, 401)],
    ["a forbidden client", () => new Response("", { status: 403 })],
    ["a wrong path", () => new Response("", { status: 404 })],
    ["a redirect", () => new Response("", { status: 302 })],
  ])("holds a refusal with %s for a minute", async (_name, answer) => {
    const endpoint = endpointAnswering(answer)
    await endpoint.read()

    expect(await endpoint.asksAgainAfter(59 * SECOND_MS)).toBe(false)
    expect(await endpoint.asksAgainAfter(2 * SECOND_MS)).toBe(true)
  })
})

describe("a token endpoint that cannot answer now", () => {
  test.each([408, 425, 500, 502, 503, 504])(
    "reads HTTP %i as unreachable and tries again after five seconds",
    async (status) => {
      const endpoint = endpointAnswering(() => new Response(null, { status }))

      expect(await endpoint.read()).toMatchObject({
        failure: "unreachable",
        message: `The token endpoint failed with HTTP ${status}.`,
      })
      expect(await endpoint.asksAgainAfter(4 * SECOND_MS)).toBe(false)
      expect(await endpoint.asksAgainAfter(2 * SECOND_MS)).toBe(true)
    },
  )

  test("reads an answer that breaks off as unreachable and tries again soon", async () => {
    const endpoint = endpointAnswering(
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new TypeError("terminated"))
            },
          }),
        ),
    )

    expect(await endpoint.read()).toMatchObject({
      failure: "unreachable",
      message: `Cannot reach the token endpoint ${TOKEN_URL}.`,
    })
    expect(await endpoint.asksAgainAfter(6 * SECOND_MS)).toBe(true)
  })
})

describe("a rate limit", () => {
  test("waits until the date it names an hour ahead, measured on the answer's own clock", async () => {
    const endpoint = new TokenEndpoint()
    const answeredAt = endpoint.now + 7 * MINUTE_MS
    endpoint.answer = () =>
      new Response("", {
        status: 429,
        headers: {
          "Retry-After": new Date(answeredAt + HOUR_MS).toUTCString(),
          Date: new Date(answeredAt).toUTCString(),
        },
      })

    expect(await endpoint.read()).toMatchObject({ failure: "engineFailure" })
    expect(await endpoint.asksAgainAfter(59 * MINUTE_MS)).toBe(false)
    expect(await endpoint.asksAgainAfter(2 * MINUTE_MS)).toBe(true)
  })

  test.each([
    ["a date in the past", "Thu, 01 Jan 1970 00:00:00 GMT"],
    ["a malformed value", "in a while"],
    ["no wait at all", "0"],
  ])("waits a minute after %s", async (_name, retryAfter) => {
    const endpoint = endpointAnswering(
      () => new Response("", { status: 429, headers: { "Retry-After": retryAfter } }),
    )
    await endpoint.read()

    expect(await endpoint.asksAgainAfter(59 * SECOND_MS)).toBe(false)
    expect(await endpoint.asksAgainAfter(2 * SECOND_MS)).toBe(true)
  })
})

describe("a token answer of more than a mebibyte", () => {
  test("is refused when it announces its size, and held for a minute", async () => {
    const endpoint = endpointAnswering(
      () => new Response("{}", { headers: { "Content-Length": String(MEBIBYTE + 1) } }),
    )

    expect(await endpoint.read()).toMatchObject({
      failure: "unexpectedResponse",
      message: "The token endpoint answered with more than 1048576 bytes.",
    })
    expect(await endpoint.asksAgainAfter(59 * SECOND_MS)).toBe(false)
    expect(await endpoint.asksAgainAfter(2 * SECOND_MS)).toBe(true)
  })

  test("is refused once it grows past the mebibyte", async () => {
    const endpoint = endpointAnswering(() => new Response(streamOf([MEBIBYTE, 1, MEBIBYTE])))

    expect(await endpoint.read()).toMatchObject({
      failure: "unexpectedResponse",
      message: "The token endpoint answered with more than 1048576 bytes.",
    })
  })

  test("is read when it fills the mebibyte exactly", async () => {
    const empty = JSON.stringify({ access_token: "token", expires_in: 3600, padding: "" })
    const full = JSON.stringify({
      access_token: "token",
      expires_in: 3600,
      padding: " ".repeat(MEBIBYTE - empty.length),
    })
    const endpoint = endpointAnswering(() => new Response(full))

    expect(full).toHaveLength(MEBIBYTE)
    expect(await endpoint.read()).toBe("answered")
  })

  test("is read by its status when it is a refusal", async () => {
    const endpoint = endpointAnswering(
      () =>
        new Response(JSON.stringify({ error: "invalid_scope" }), {
          status: 401,
          headers: { "Content-Length": String(2 * MEBIBYTE) },
        }),
    )

    expect(await endpoint.read()).toMatchObject({
      failure: "unauthorized",
      message: "The token endpoint refused the client ID or secret (HTTP 401).",
    })
  })
})
