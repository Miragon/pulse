import { describe, expect, it } from "vitest"
import {
  discover,
  discoveryUrls,
  type MetadataNeeds,
  oauthUrlProblem,
  serverMetadata,
} from "../../src/oauth/index.js"
import { failWith, jsonAnswer, networkError } from "../fake-fetch.js"
import { failureOf, oauthPlatform, omit } from "./support.js"

const ISSUER = "https://login.example.com/realms/camunda"
const isLoopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host)
const PUBLIC: MetadataNeeds = { confidential: false, isLoopback }
const DOCUMENT = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  revocation_endpoint: `${ISSUER}/revoke`,
  code_challenge_methods_supported: ["plain", "S256"],
  authorization_response_iss_parameter_supported: true,
  token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
}

describe("discoveryUrls", () => {
  it("puts the OpenID location after the issuer, the RFC 8414 one before its path", () => {
    expect(discoveryUrls(`${ISSUER}/`)).toEqual([
      `${ISSUER}/.well-known/openid-configuration`,
      "https://login.example.com/.well-known/oauth-authorization-server/realms/camunda",
    ])
    expect(discoveryUrls("https://tenant.auth0.com/")).toEqual([
      "https://tenant.auth0.com/.well-known/openid-configuration",
      "https://tenant.auth0.com/.well-known/oauth-authorization-server",
    ])
  })
})

describe("discover", () => {
  it("reads the OpenID document", async () => {
    const { platform, calls } = oauthPlatform([jsonAnswer(DOCUMENT)])
    const answers = await discover(ISSUER, platform)
    expect(answers).toEqual([
      {
        url: `${ISSUER}/.well-known/openid-configuration`,
        status: 200,
        statusText: "OK",
        json: DOCUMENT,
      },
    ])
    expect(calls[0]).toMatchObject({ method: "GET", redirect: "manual", body: undefined })
    expect(calls[0]?.headers).toEqual({ accept: "application/json" })
  })

  it("falls back to RFC 8414 after a 404, and only after one", async () => {
    const { platform } = oauthPlatform([new Response("", { status: 404 }), jsonAnswer(DOCUMENT)])
    const answers = await discover(ISSUER, platform)
    expect(answers.map(({ url, status }) => [url, status])).toEqual([
      [`${ISSUER}/.well-known/openid-configuration`, 404],
      ["https://login.example.com/.well-known/oauth-authorization-server/realms/camunda", 200],
    ])
    const failed = oauthPlatform([new Response("", { status: 500 })])
    await expect(discover(ISSUER, failed.platform, { timeoutMs: 1000 })).resolves.toHaveLength(1)
  })

  it("answers a redirect unread and fails without an answer", async () => {
    const moved = oauthPlatform([new Response("", { status: 302, headers: { Location: "/x" } })])
    expect(await discover(ISSUER, moved.platform)).toEqual([
      expect.objectContaining({ status: 302, statusText: "Found", json: undefined }),
    ])
    const down = oauthPlatform([failWith(networkError("ECONNREFUSED"))])
    expect(await failureOf(discover(ISSUER, down.platform))).toMatchObject({ kind: "unreachable" })
  })
})

describe("oauthUrlProblem", () => {
  it.each([
    ["https://as/token", undefined],
    ["  https://as/token?p=b2c  ", undefined],
    ["http://localhost:8080/t", undefined],
    ["http://127.0.0.1/t", undefined],
    ["not a url", "not-a-url"],
    ["https://user:pw@as/t", "credentials"],
    ["https://user@as/t", "credentials"],
    ["http://as.example.com/t", "insecure"],
    ["ftp://localhost/t", "insecure"],
    ["https://as/t#part", "fragment"],
    ["https://as/t#", "fragment"],
    ["https://as/t#  ", "fragment"],
    ["https://:pw@as/t", "credentials"],
  ])("reads %j as %j", (url, problem) => {
    expect(oauthUrlProblem(url, isLoopback)).toBe(problem)
  })
})

describe("serverMetadata", () => {
  it("takes the endpoints, the revocation, the iss parameter and Basic", () => {
    expect(serverMetadata(DOCUMENT, ISSUER, PUBLIC)).toEqual({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/auth`,
      tokenEndpoint: `${ISSUER}/token`,
      revocationEndpoint: `${ISSUER}/revoke`,
      issParameterRequired: true,
      clientAuth: "basic",
    })
  })

  it("trims the endpoints, leaves out an unusable revocation and reads a missing iss flag", () => {
    const document = {
      ...DOCUMENT,
      authorization_endpoint: ` ${ISSUER}/auth `,
      revocation_endpoint: "http://as.example.com/revoke",
      authorization_response_iss_parameter_supported: "yes",
    }
    expect(
      serverMetadata({ ...DOCUMENT, revocation_endpoint: ` ${ISSUER}/revoke ` }, ISSUER, PUBLIC),
    ).toMatchObject({ revocationEndpoint: `${ISSUER}/revoke` })
    expect(serverMetadata(document, ISSUER, PUBLIC)).toMatchObject({
      authorizationEndpoint: `${ISSUER}/auth`,
      issParameterRequired: false,
    })
    expect(serverMetadata(document, ISSUER, PUBLIC)).not.toHaveProperty("revocationEndpoint")
    const without = omit(DOCUMENT, "revocation_endpoint")
    expect(serverMetadata(without, ISSUER, PUBLIC)).not.toHaveProperty("revocationEndpoint")
  })

  it.each([
    [{ issuer: undefined }, { problem: "no-issuer" }],
    [{ issuer: 7 }, { problem: "no-issuer" }],
    [{ issuer: `${ISSUER}/` }, { problem: "other-issuer", named: `${ISSUER}/` }],
    [{ authorization_endpoint: " " }, { problem: "no-endpoint", key: "authorization_endpoint" }],
    [{ token_endpoint: undefined }, { problem: "no-endpoint", key: "token_endpoint" }],
    [
      { authorization_endpoint: "http://as.example.com/a" },
      {
        problem: "endpoint-url",
        key: "authorization_endpoint",
        url: "http://as.example.com/a",
        urlProblem: "insecure",
      },
    ],
    [
      { token_endpoint: "https://as/t#x" },
      {
        problem: "endpoint-url",
        key: "token_endpoint",
        url: "https://as/t#x",
        urlProblem: "fragment",
      },
    ],
    [{ code_challenge_methods_supported: ["plain"] }, { problem: "no-pkce" }],
  ])("refuses a document with %j", (change, problem) => {
    expect(serverMetadata({ ...DOCUMENT, ...change }, ISSUER, PUBLIC)).toEqual(problem)
  })

  it("takes S256 for granted and Basic too when the document lists no methods", () => {
    const bare = omit(
      DOCUMENT,
      "code_challenge_methods_supported",
      "token_endpoint_auth_methods_supported",
    )
    expect(serverMetadata(bare, ISSUER, { ...PUBLIC, confidential: true })).toMatchObject({
      clientAuth: "basic",
    })
  })

  it("authenticates a confidential client with post where only post is offered, else refuses", () => {
    const only = (methods: string[]) => ({
      ...DOCUMENT,
      token_endpoint_auth_methods_supported: methods,
    })
    const secret = { ...PUBLIC, confidential: true }
    expect(serverMetadata(only(["client_secret_post"]), ISSUER, secret)).toMatchObject({
      clientAuth: "post",
    })
    expect(serverMetadata(only(["private_key_jwt"]), ISSUER, secret)).toEqual({
      problem: "client-auth",
    })
    expect(serverMetadata(only(["private_key_jwt"]), ISSUER, PUBLIC)).toMatchObject({
      clientAuth: "basic",
    })
  })
})
