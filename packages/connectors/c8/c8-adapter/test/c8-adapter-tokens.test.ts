import { describe, expect, test } from "vitest"
import { jsonAnswer } from "./support/fake-camunda-rest.js"
import { CREDENTIALS, LoginService, MINUTE_MS, SECRET } from "./support/token-endpoint.js"

const CLUSTER = "https://bru-2.zeebe.test/cluster-a/v2"
const OTHER_CLUSTER = "https://bru-2.zeebe.test/cluster-b/v2"

function refusing(): Response {
  return jsonAnswer({ error: "invalid_client" }, 401)
}

describe("the tokens of the C8 adapter", () => {
  test("serve a runtime built anew for the same cluster, as on every reload, without a second request", async () => {
    const login = new LoginService()

    expect(await login.readFrom(CLUSTER)).toBe("answered")
    expect(await login.readFrom(CLUSTER)).toBe("answered")

    expect(login.tokenForms).toHaveLength(1)
    expect(login.apiCalls).toEqual([
      "/cluster-a/v2/topology Bearer token-1",
      "/cluster-a/v2/topology Bearer token-1",
    ])
  })

  test("keep a refusal's hold across reloads, so a wrong secret costs one request a minute", async () => {
    const login = new LoginService()
    login.answerToken = refusing

    await login.readFrom(CLUSTER)
    await login.readFrom(CLUSTER)
    login.now += MINUTE_MS
    await login.readFrom(CLUSTER)

    expect(login.tokenForms).toHaveLength(2)
    expect(login.apiCalls).toEqual([])
  })

  test("replace the source of a cluster's client when its secret is corrected, keeping no wrong one", async () => {
    const login = new LoginService()
    login.answerToken = refusing
    await login.readFrom(CLUSTER, { ...CREDENTIALS, clientSecret: "wrong" })

    login.answerToken = () => jsonAnswer({ access_token: "fresh", expires_in: 3600 })
    expect(await login.readFrom(CLUSTER)).toBe("answered")
    expect(await login.readFrom(CLUSTER, { ...CREDENTIALS, clientSecret: "wrong" })).toBe(
      "answered",
    )

    expect(login.tokenForms.map((form) => form.get("client_secret"))).toEqual([
      "wrong",
      SECRET,
      "wrong",
    ])
  })

  test("replace the source when the audience or the scopes change, but not for their order", async () => {
    const login = new LoginService()

    await login.readFrom(CLUSTER)
    await login.readFrom(CLUSTER, { ...CREDENTIALS, scopes: ["more", "read"] })
    await login.readFrom(CLUSTER, { ...CREDENTIALS, audience: "zeebe-api" })
    await login.readFrom(CLUSTER, { ...CREDENTIALS, audience: "zeebe-api", scopes: ["read"] })

    expect(login.tokenForms.map((form) => [form.get("audience"), form.get("scope")])).toEqual([
      ["orchestration-api", "read more"],
      ["zeebe-api", "read more"],
      ["zeebe-api", "read"],
    ])
  })

  test("keep a token per cluster when two clusters share a client", async () => {
    const login = new LoginService()

    await login.readFrom(CLUSTER)
    await login.readFrom(OTHER_CLUSTER, { ...CREDENTIALS, audience: "cluster-b" })
    await login.readFrom(CLUSTER)
    await login.readFrom(OTHER_CLUSTER, { ...CREDENTIALS, audience: "cluster-b" })

    expect(login.tokenForms.map((form) => form.get("audience"))).toEqual([
      "orchestration-api",
      "cluster-b",
    ])
    expect(login.apiCalls).toEqual([
      "/cluster-a/v2/topology Bearer token-1",
      "/cluster-b/v2/topology Bearer token-2",
      "/cluster-a/v2/topology Bearer token-1",
      "/cluster-b/v2/topology Bearer token-2",
    ])
  })
})
