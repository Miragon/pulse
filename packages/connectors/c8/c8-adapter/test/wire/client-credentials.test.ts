import { describe, expect, test } from "vitest"
import { jsonAnswer } from "../support/fake-camunda-rest.js"
import {
  CREDENTIALS,
  LoginService,
  MINUTE_MS,
  SECRET,
  TOKEN_URL,
} from "../support/token-endpoint.js"

const REFUSED_CLIENT = {
  name: "RuntimeError",
  failure: "unauthorized",
  message: "The token endpoint refused the client ID or secret (invalid_client).",
}

function refusing(): Response {
  return jsonAnswer({ error: "invalid_client", error_description: `bad ${SECRET}` }, 401)
}

describe("client credentials", () => {
  test("ask the token endpoint for a token with the client, the audience and the scopes", async () => {
    const login = new LoginService()

    expect(await login.read()).toBe("answered")

    expect(login.tokenForms.map((form) => Object.fromEntries(form))).toEqual([
      {
        grant_type: "client_credentials",
        client_id: "pulse",
        client_secret: SECRET,
        audience: "orchestration-api",
        scope: "read more",
      },
    ])
    expect(login.apiAuthorizations).toEqual(["Bearer token-1"])
  })

  test("send neither audience nor scope when the connection names none", async () => {
    const login = new LoginService()

    await login.read({
      kind: "clientCredentials",
      tokenEndpoint: TOKEN_URL,
      clientId: "pulse",
      clientSecret: SECRET,
    })

    expect([...(login.tokenForms[0]?.keys() ?? [])]).toEqual([
      "grant_type",
      "client_id",
      "client_secret",
    ])
  })

  test("keep the token of a connection that is built anew, as on every reload", async () => {
    const login = new LoginService()

    await login.read()
    await login.read({ ...CREDENTIALS, scopes: ["more", "read"] })
    await login.read()

    expect(login.tokenForms).toHaveLength(1)
    expect(login.apiAuthorizations).toEqual(["Bearer token-1", "Bearer token-1", "Bearer token-1"])
  })

  test("keep the hold of a refusal on a connection built anew, so a wrong secret costs one request", async () => {
    const login = new LoginService()
    login.answerToken = refusing

    expect(await login.read()).toMatchObject(REFUSED_CLIENT)
    expect(await login.read()).toMatchObject(REFUSED_CLIENT)

    expect(login.tokenForms).toHaveLength(1)
    expect(login.apiAuthorizations).toEqual([])
  })

  test("ask again once the hold of a refusal has passed", async () => {
    const login = new LoginService()
    login.answerToken = refusing
    await login.read()

    login.now += MINUTE_MS
    await login.read()

    expect(login.tokenForms).toHaveLength(2)
  })

  test("ask at once with another secret, which replaces the source of that client", async () => {
    const login = new LoginService()
    login.answerToken = refusing
    await login.read()

    login.answerToken = () => jsonAnswer({ access_token: "fresh", expires_in: 3600 })
    expect(await login.read({ ...CREDENTIALS, clientSecret: "another-secret" })).toBe("answered")
    expect(await login.read()).toBe("answered")

    expect(login.tokenForms.map((form) => form.get("client_secret"))).toEqual([
      SECRET,
      "another-secret",
      SECRET,
    ])
    expect(login.apiAuthorizations).toEqual(["Bearer fresh", "Bearer fresh"])
  })

  test("give up on a silent token endpoint at the profile's deadline, at most the token's own 30 s", async () => {
    const login = new LoginService()
    login.answerToken = () => new Promise<Response>(() => undefined)
    const started = performance.now()

    expect(await login.readWithin(50)).toMatchObject({
      name: "RuntimeError",
      failure: "unreachable",
    })

    expect(performance.now() - started).toBeLessThan(2_000)
    expect(login.tokenForms).toHaveLength(1)
    expect(login.apiCalls).toEqual([])
  })

  test("ask for a token anew when the profile's deadline changes, as for another secret", async () => {
    const login = new LoginService()
    login.answerToken = refusing
    await login.read()

    login.answerToken = () => jsonAnswer({ access_token: "fresh", expires_in: 3600 })
    expect(await login.readWithin(5_000)).toBe("answered")

    expect(login.tokenForms).toHaveLength(2)
    expect(login.apiAuthorizations).toEqual(["Bearer fresh"])
  })

  test("never show the token the cluster echoes in an error", async () => {
    const login = new LoginService()
    login.answerApi = () => jsonAnswer({ message: "token-1 refused" }, 500)

    expect(await login.read()).toMatchObject({
      failure: "engineFailure",
      message: "HTTP 500 Internal Server Error: *** refused",
    })
  })

  test("never show the secret or the description a refusal echoes", async () => {
    const login = new LoginService()
    login.answerToken = refusing

    const error = (await login.read()) as Error

    expect(`${error.message} ${String(error.cause)}`).not.toContain(SECRET)
  })
})
