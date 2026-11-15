import { describe, expect, test } from "vitest"
import { TokenTexts } from "../../src/errors/token-texts.js"
import type { TokenReason } from "../../src/wire/wire-reason.js"
import { jsonAnswer } from "../support/fake-camunda-rest.js"
import { CREDENTIALS, LoginService, SECRET, TOKEN_URL } from "../support/token-endpoint.js"

const ENDPOINT_HINT = "The profile's tokenEndpoint must be the URL that issues tokens."
const REQUEST_HINT =
  "Check the audience and the scopes in the profile. Pulse sends them as written."
const GRANT_HINT =
  "Check that the login service lets this client get a token for the audience and the scopes in the profile."
const CLIENT_HINT = "Check the client ID and the secret you entered for this engine."
const NO_TOKEN = "The token endpoint answered without a token."

interface Expected {
  readonly failure: string
  readonly message: string
  readonly hint?: string
}

function answering(answer: () => Response): Promise<unknown> {
  const login = new LoginService()
  login.answerToken = answer
  return login.read()
}

function reasonOf(trouble: TokenReason["trouble"]): TokenReason {
  return {
    kind: "token",
    trouble,
    endpoint: TOKEN_URL,
    status: undefined,
    code: undefined,
    problem: undefined,
    holdMs: 5000,
    cause: undefined,
  }
}

describe("a token endpoint's refusal", () => {
  test.each<[string, () => Response, Expected]>([
    [
      "a 401 without a code",
      () => new Response("", { status: 401 }),
      {
        failure: "unauthorized",
        message: "The token endpoint refused the client ID or secret (HTTP 401).",
        hint: CLIENT_HINT,
      },
    ],
    [
      "a client the endpoint does not admit",
      () => jsonAnswer({ error: "unauthorized_client" }, 400),
      {
        failure: "unauthorized",
        message: "The token endpoint refused the client ID or secret (unauthorized_client).",
        hint: CLIENT_HINT,
      },
    ],
    [
      "a scope it does not grant",
      () => jsonAnswer({ error: "invalid_scope", error_description: `no ${SECRET}` }, 400),
      {
        failure: "misconfigured",
        message: "The token endpoint refused the request (invalid_scope).",
        hint: REQUEST_HINT,
      },
    ],
    [
      "a code reduced to its characters",
      () => jsonAnswer({ error: "access denied!\n<b>" }, 400),
      {
        failure: "misconfigured",
        message: "The token endpoint refused the request (accessdeniedb).",
        hint: REQUEST_HINT,
      },
    ],
    [
      "a 400 without a code",
      () => new Response("", { status: 400 }),
      {
        failure: "misconfigured",
        message: `The token endpoint ${TOKEN_URL} answered with HTTP 400.`,
        hint: ENDPOINT_HINT,
      },
    ],
    [
      "a 403",
      () => new Response("", { status: 403 }),
      {
        failure: "forbidden",
        message: "The token endpoint refused to issue a token for this client (HTTP 403).",
        hint: GRANT_HINT,
      },
    ],
    [
      "a rate limit",
      () => new Response("", { status: 429, headers: { "Retry-After": "120" } }),
      {
        failure: "engineFailure",
        message:
          "The token endpoint limits requests from this address. Pulse waits as long as the endpoint asks before it requests another token.",
      },
    ],
    [
      "an endpoint that cannot answer now",
      () => new Response("", { status: 503 }),
      { failure: "unreachable", message: "The token endpoint failed with HTTP 503." },
    ],
    [
      "a redirect",
      () => new Response("", { status: 302, headers: { Location: "https://login.test/" } }),
      {
        failure: "misconfigured",
        message: "The token endpoint answered with a redirect.",
        hint: ENDPOINT_HINT,
      },
    ],
    [
      "an answer of more than a mebibyte",
      () => new Response("x".repeat(1024 * 1024 + 1), { status: 200 }),
      {
        failure: "unexpectedResponse",
        message: "The token endpoint answered with more than 1 MiB.",
      },
    ],
    [
      "an answer that is no JSON",
      () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }),
      { failure: "unexpectedResponse", message: NO_TOKEN },
    ],
    [
      "an answer without a token",
      () => jsonAnswer({ expires_in: 300 }),
      { failure: "unexpectedResponse", message: NO_TOKEN },
    ],
    [
      "a token outside the Bearer token syntax",
      () => jsonAnswer({ access_token: "a token" }),
      {
        failure: "unexpectedResponse",
        message:
          "The token endpoint answered with a token outside the Bearer token syntax (RFC 6750).",
      },
    ],
    [
      "a token of another type",
      () => jsonAnswer({ access_token: "token", token_type: "mac" }),
      {
        failure: "unexpectedResponse",
        message: "The token endpoint answered with a token of another type than Bearer.",
      },
    ],
  ])("words %s with its way out", async (_name, answer, expected) => {
    const error = await answering(answer)

    expect(error).toMatchObject({ name: "RuntimeError", ...expected })
    expect((error as { hint?: string }).hint).toBe(expected.hint)
    expect((error as Error).message).not.toContain(SECRET)
  })

  test("names an endpoint that cannot be reached, without its query", async () => {
    const login = new LoginService()
    const tokenEndpoint = `${TOKEN_URL}?tenant=t1#start`
    login.answerToken = () => {
      throw new TypeError("fetch failed")
    }

    expect(await login.read({ ...CREDENTIALS, tokenEndpoint })).toMatchObject({
      failure: "unreachable",
      message: `Cannot reach the token endpoint ${TOKEN_URL}.`,
    })
  })

  test("refuses a token endpoint that is no http or https URL, asking nothing", async () => {
    const login = new LoginService()

    expect(
      await login.read({ ...CREDENTIALS, tokenEndpoint: "ftp://login.test/token" }),
    ).toMatchObject({
      failure: "misconfigured",
      message:
        "The token endpoint URL cannot be used: the authorization server URL must use http or https",
    })
    expect(login.tokenForms).toEqual([])
  })

  test.each<[TokenReason["trouble"], Expected]>([
    [
      "timeout",
      {
        failure: "unreachable",
        message: `The token endpoint ${TOKEN_URL} did not answer in time.`,
      },
    ],
    [
      "expired",
      {
        failure: "unauthorized",
        message: "The token expired, and the token endpoint gave no new one.",
      },
    ],
    [
      "unexpected",
      {
        failure: "misconfigured",
        message: `The token endpoint ${TOKEN_URL} answered with HTTP 0.`,
        hint: ENDPOINT_HINT,
      },
    ],
    ["unavailable", { failure: "unreachable", message: "The token endpoint failed with HTTP 0." }],
    [
      "client",
      {
        failure: "unauthorized",
        message: "The token endpoint refused the client ID or secret (HTTP 401).",
        hint: CLIENT_HINT,
      },
    ],
    [
      "grant",
      {
        failure: "misconfigured",
        message: "The token endpoint refused the request (HTTP 400).",
        hint: REQUEST_HINT,
      },
    ],
  ])("words a %s that names neither status nor code", (trouble, expected) => {
    const error = TokenTexts.errorOf(reasonOf(trouble))

    expect(error).toMatchObject(expected)
    expect(error.hint).toBe(expected.hint)
  })
})
