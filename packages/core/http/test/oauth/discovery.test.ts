import { describe, expect, it } from "vitest"
import { discoveryUrls } from "../../src/oauth/discovery.js"
import {
  discover,
  keyMetadata,
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
  end_session_endpoint: `${ISSUER}/logout`,
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
  it("takes the endpoints, the revocation, the end session, the iss parameter and Basic", () => {
    expect(serverMetadata(DOCUMENT, ISSUER, PUBLIC)).toEqual({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/auth`,
      tokenEndpoint: `${ISSUER}/token`,
      revocationEndpoint: `${ISSUER}/revoke`,
      endSessionEndpoint: `${ISSUER}/logout`,
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

  it("checks the end session endpoint like the others and leaves it out when unusable", () => {
    const endSession = (value: unknown) =>
      serverMetadata({ ...DOCUMENT, end_session_endpoint: value }, ISSUER, PUBLIC)
    expect(endSession(` ${ISSUER}/logout?x=1 `)).toMatchObject({
      endSessionEndpoint: `${ISSUER}/logout?x=1`,
    })
    for (const unusable of [
      "http://as.example.com/logout",
      "http://localhost:8080/logout",
      "https://user@as/logout",
      "https://as/logout#x",
      "not a url",
      7,
      undefined,
    ]) {
      const metadata = endSession(unusable)
      expect(metadata).not.toHaveProperty("endSessionEndpoint")
      expect(metadata).toMatchObject({ revocationEndpoint: `${ISSUER}/revoke` })
    }
  })

  it.each([
    ["no issuer", { issuer: undefined }, { problem: "no-issuer" }],
    ["an issuer that is a number", { issuer: 7 }, { problem: "no-issuer" }],
    ["another issuer", { issuer: `${ISSUER}/` }, { problem: "other-issuer", named: `${ISSUER}/` }],
    [
      "a blank authorization endpoint",
      { authorization_endpoint: " " },
      { problem: "no-endpoint", key: "authorization_endpoint" },
    ],
    [
      "no token endpoint",
      { token_endpoint: undefined },
      { problem: "no-endpoint", key: "token_endpoint" },
    ],
    [
      "an authorization endpoint on plain http",
      { authorization_endpoint: "http://as.example.com/a" },
      {
        problem: "endpoint-url",
        key: "authorization_endpoint",
        url: "http://as.example.com/a",
        urlProblem: "insecure",
      },
    ],
    [
      "a token endpoint with a fragment",
      { token_endpoint: "https://as/t#x" },
      {
        problem: "endpoint-url",
        key: "token_endpoint",
        url: "https://as/t#x",
        urlProblem: "fragment",
      },
    ],
    ["no PKCE with S256", { code_challenge_methods_supported: ["plain"] }, { problem: "no-pkce" }],
  ])("refuses a document with %s", (_case, change, problem) => {
    expect(serverMetadata({ ...DOCUMENT, ...change }, ISSUER, PUBLIC)).toEqual(problem)
  })

  it.each<[string, string]>([
    ["authorization_endpoint", "http://127.0.0.1:8080/auth"],
    ["token_endpoint", " https://localhost/token "],
    ["token_endpoint", "http://[::1]/token"],
  ])("refuses the %s %j on a loopback host named by a remote issuer", (key, url) => {
    expect(serverMetadata({ ...DOCUMENT, [key]: url }, ISSUER, PUBLIC)).toEqual({
      problem: "endpoint-loopback",
      key,
      url,
    })
  })

  it("leaves out a revocation or end session endpoint on a loopback host of a remote issuer", () => {
    const loopback = {
      ...DOCUMENT,
      revocation_endpoint: "http://127.0.0.1:9/revoke",
      end_session_endpoint: " https://localhost/logout ",
    }
    const metadata = serverMetadata(loopback, ISSUER, PUBLIC)
    expect(metadata).toMatchObject({ tokenEndpoint: `${ISSUER}/token` })
    expect(metadata).not.toHaveProperty("revocationEndpoint")
    expect(metadata).not.toHaveProperty("endSessionEndpoint")
  })

  it("takes every endpoint on a loopback host from an issuer on one", () => {
    const local = "http://127.0.0.1:8080/realms/pulse"
    const at = "http://localhost:8080/realms/pulse"
    const document = {
      issuer: local,
      authorization_endpoint: `${at}/auth`,
      token_endpoint: ` ${at}/token `,
      revocation_endpoint: `${at}/revoke`,
      end_session_endpoint: `${at}/logout`,
    }
    expect(serverMetadata(document, local, PUBLIC)).toEqual({
      issuer: local,
      authorizationEndpoint: `${at}/auth`,
      tokenEndpoint: `${at}/token`,
      revocationEndpoint: `${at}/revoke`,
      endSessionEndpoint: `${at}/logout`,
      issParameterRequired: false,
      clientAuth: "basic",
    })
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

describe("keyMetadata", () => {
  const FS = "https://fs.example.com/adfs"
  const ADFS = {
    issuer: FS,
    jwks_uri: ` ${FS}/discovery/keys `,
    access_token_issuer: "http://fs.example.com/adfs/services/trust",
    token_endpoint_auth_methods_supported: ["private_key_jwt"],
  }

  it("takes the key set and the access tokens' issuer as named, http kept, nothing of a sign-in", () => {
    expect(keyMetadata(ADFS, FS, PUBLIC)).toEqual({
      issuer: FS,
      jwksUri: `${FS}/discovery/keys`,
      accessTokenIssuer: "http://fs.example.com/adfs/services/trust",
    })
    expect(serverMetadata(ADFS, FS, { ...PUBLIC, confidential: true })).toEqual({
      problem: "no-endpoint",
      key: "authorization_endpoint",
    })
    expect(keyMetadata({ ...DOCUMENT, jwks_uri: `${ISSUER}/certs` }, ISSUER, PUBLIC)).toStrictEqual(
      {
        issuer: ISSUER,
        jwksUri: `${ISSUER}/certs`,
      },
    )
  })

  it("keeps an access tokens' issuer on https as named", () => {
    const entra = "https://sts.windows.net/9188040d-6c67-4c5b-b112-36a304b66dad/"
    expect(keyMetadata({ ...ADFS, access_token_issuer: entra }, FS, PUBLIC)).toMatchObject({
      accessTokenIssuer: entra,
    })
  })

  it.each([
    ["missing", undefined],
    ["a number", 7],
    ["empty", ""],
    ["no URL", "not a url"],
    ["a path", "/adfs/services/trust"],
    ["a URN", "urn:adfs:trust"],
    ["on ftp", "ftp://fs/t"],
    ["a list", ["https://fs.example.com/adfs/services/trust"]],
  ])("leaves out the access tokens' issuer when it is %s", (_case, value) => {
    const metadata = keyMetadata({ ...ADFS, access_token_issuer: value }, FS, PUBLIC)
    expect(metadata).toStrictEqual({ issuer: FS, jwksUri: `${FS}/discovery/keys` })
  })

  it.each([
    ["no issuer", { issuer: undefined }, { problem: "no-issuer" }],
    ["another issuer", { issuer: `${FS}/` }, { problem: "other-issuer", named: `${FS}/` }],
    ["no key set", { jwks_uri: undefined }, { problem: "no-jwks" }],
    ["a key set that is a number", { jwks_uri: 7 }, { problem: "no-jwks" }],
    ["a blank key set", { jwks_uri: " " }, { problem: "no-jwks" }],
    [
      "a key set on plain http",
      { jwks_uri: "http://fs.example.com/keys" },
      { problem: "jwks-insecure", url: "http://fs.example.com/keys", urlProblem: "insecure" },
    ],
    [
      "a key set with user info",
      { jwks_uri: "https://user@fs/keys" },
      { problem: "jwks-insecure", url: "https://user@fs/keys", urlProblem: "credentials" },
    ],
    [
      "a key set with a fragment",
      { jwks_uri: "https://fs/keys#x" },
      { problem: "jwks-insecure", url: "https://fs/keys#x", urlProblem: "fragment" },
    ],
    [
      "a key set that is no URL",
      { jwks_uri: "keys" },
      { problem: "jwks-insecure", url: "keys", urlProblem: "not-a-url" },
    ],
  ])("refuses a document with %s", (_case, change, problem) => {
    expect(keyMetadata({ ...ADFS, ...change }, FS, PUBLIC)).toEqual(problem)
  })

  it.each(["http://127.0.0.1:8080/keys", " https://localhost/keys ", "http://[::1]/keys"])(
    "refuses the key set %j on a loopback host named by a remote issuer",
    (url) => {
      expect(keyMetadata({ ...ADFS, jwks_uri: url }, FS, PUBLIC)).toEqual({
        problem: "jwks-loopback",
        url,
      })
    },
  )

  it("takes a key set on a loopback host from an issuer on one, and from no other", () => {
    const local = "http://127.0.0.1:8080/realms/pulse"
    const keys = "http://localhost:8080/realms/pulse/certs"
    expect(keyMetadata({ issuer: local, jwks_uri: keys }, local, PUBLIC)).toEqual({
      issuer: local,
      jwksUri: keys,
    })
    expect(keyMetadata({ issuer: "pulse", jwks_uri: keys }, "pulse", PUBLIC)).toEqual({
      problem: "jwks-loopback",
      url: keys,
    })
    expect(keyMetadata({ issuer: "pulse", jwks_uri: `${FS}/keys` }, "pulse", PUBLIC)).toEqual({
      issuer: "pulse",
      jwksUri: `${FS}/keys`,
    })
  })
})
