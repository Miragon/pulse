import crypto from "node:crypto"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { AuthInfo } from "@modelcontextprotocol/server"
import { oauthGate } from "./oauth-gate.js"
import { NOT_BEFORE_LEEWAY_SECONDS } from "./oauth-jwt.js"
import { oauthKeycloakProvider, type OAuthProvider } from "./oauth-providers.js"

/**
 * The JWT verifier against a loopback IdP that serves only its key set, with tokens this file
 * signs: the case matrix the port was red-teamed with (issuer, audience and resource, algorithms,
 * clock, the key set failing), each through the gate the boot puts in front of `/mcp`.
 */

const RESOURCE = new URL("http://localhost/mcp")
const AUD = RESOURCE.href

type Mode = "ok" | "500" | "html" | "malformed"

interface Idp {
  url: string
  issuer: string
  mode: Mode
  keys: object[]
  hits: number
  close(): Promise<void>
}

const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
const rsa2 = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
const rsa3 = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 })
const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" })
const jwk = (key: crypto.KeyObject, extra: Record<string, unknown>) => ({
  ...key.export({ format: "jwk" }),
  use: "sig",
  ...extra,
})
const JWK_RSA = jwk(rsa.publicKey, { kid: "k1", alg: "RS256" })
const JWK_RSA2 = jwk(rsa2.publicKey, { kid: "k2", alg: "RS256" })
const JWK_EC = jwk(ec.publicKey, { kid: "e1", alg: "ES256" })

async function startIdp(): Promise<Idp> {
  const state = { mode: "ok" as Mode, keys: [JWK_RSA, JWK_EC] as object[], hits: 0 }
  const server = http.createServer((_req, res) => {
    state.hits += 1
    if (state.mode === "500") {
      res.statusCode = 500
      return res.end("boom")
    }
    if (state.mode === "html") {
      res.setHeader("content-type", "text/html")
      return res.end("<html></html>")
    }
    res.setHeader("content-type", "application/json")
    res.end(JSON.stringify(state.mode === "malformed" ? { keys: "nope" } : { keys: state.keys }))
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return Object.assign(state, {
    url,
    issuer: `${url}/realms/platform`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  })
}

const segment = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url")

interface SignOptions {
  key?: crypto.KeyObject | string
  alg?: string
  kid?: string | null
  typ?: string
  header?: Record<string, unknown>
}

function sign(claims: Record<string, unknown>, options: SignOptions = {}): string {
  const { key = rsa.privateKey, alg = "RS256", kid = "k1", typ = "JWT", header = {} } = options
  const head = { alg, typ, ...(kid === null ? {} : { kid }), ...header }
  const input = `${segment(head)}.${segment(claims)}`
  const data = Buffer.from(input)
  let signature: Buffer
  if (alg === "RS256") signature = crypto.sign("RSA-SHA256", data, key)
  else if (alg === "RS512") signature = crypto.sign("RSA-SHA512", data, key)
  else if (alg === "PS256") {
    signature = crypto.sign("sha256", data, {
      key: key as crypto.KeyObject,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
  } else if (alg === "ES256") {
    signature = crypto.sign("sha256", data, {
      key: key as crypto.KeyObject,
      dsaEncoding: "ieee-p1363",
    })
  } else if (alg === "HS256") signature = crypto.createHmac("sha256", key).update(input).digest()
  else signature = Buffer.alloc(0)
  return `${input}.${signature.toString("base64url")}`
}

const now = () => Math.floor(Date.now() / 1000)

let idp: Idp

beforeAll(async () => {
  idp = await startIdp()
})

afterAll(() => idp.close())

afterEach(() => {
  idp.mode = "ok"
  idp.keys = [JWK_RSA, JWK_EC]
  vi.restoreAllMocks()
})

const good = () => ({ iss: idp.issuer, aud: AUD, sub: "u1", exp: now() + 3600 })

const keycloak = (debug = false) =>
  oauthKeycloakProvider({ serverUrl: idp.url, realm: "platform", debug })

/** A fresh gate: its own key-set cache, as a freshly booted server has. */
const gateOf = (provider: OAuthProvider = keycloak(), onUnexpected = vi.fn()) =>
  oauthGate(provider, RESOURCE, onUnexpected)

const call = (gate: ReturnType<typeof gateOf>, authorization?: string) =>
  gate(
    new Request(AUD, {
      method: "POST",
      headers: authorization === undefined ? {} : { authorization },
    }),
  )

const bearer = (token: string) => `Bearer ${token}`

/** The refusal's status and the description its body (and challenge) carries. */
async function refusal(result: AuthInfo | Response) {
  expect(result).toBeInstanceOf(Response)
  const response = result as Response
  const body = (await response.json()) as { error: string; error_description: string }
  return { status: response.status, error: body.error, description: body.error_description }
}

describe("the bearer gate: tokens", () => {
  it("serves a valid token with the caller under extra, its scopes and its client", async () => {
    const token = sign({ ...good(), scope: "read write", azp: "claude" })
    const info = (await call(gateOf(), bearer(token))) as AuthInfo
    expect(info.extra).toMatchObject({ user: { id: "u1" }, payload: { sub: "u1" } })
    expect(info.scopes).toEqual(["read", "write"])
    expect(info.clientId).toBe("claude")
    expect(info.resource?.href).toBe(AUD)
    expect(info.resourceMetadataUrl).toBe(
      "http://localhost/.well-known/oauth-protected-resource/mcp",
    )
  })

  it("reads scope as an array too, and client_id before azp", async () => {
    const token = sign({ ...good(), scope: ["a", "", 7, "b"], client_id: "c1", azp: "x" })
    const info = (await call(gateOf(), bearer(token))) as AuthInfo
    expect(info.scopes).toEqual(["a", "b"])
    expect(info.clientId).toBe("c1")
  })

  it.each<[string, () => Record<string, unknown>, string]>([
    [
      "an issuer of another realm",
      () => ({ ...good(), iss: `${idp.url}/realms/other` }),
      "JWT verification failed",
    ],
    ["no sub", () => ({ ...good(), sub: undefined }), "JWT verification failed"],
    ["a blank sub", () => ({ ...good(), sub: "   " }), "Token identity mapping failed"],
    ["a numeric sub", () => ({ ...good(), sub: 7 }), "Token identity mapping failed"],
    ["no exp", () => ({ ...good(), exp: undefined }), "JWT verification failed"],
    [
      "exp as a string",
      () => ({ ...good(), exp: String(now() + 3600) }),
      "JWT verification failed",
    ],
    ["an exp a second past", () => ({ ...good(), exp: now() - 1 }), "Missing or expired exp claim"],
    ["an nbf an hour ahead", () => ({ ...good(), nbf: now() + 3600 }), "JWT verification failed"],
  ])("refuses a token with %s: 401", async (_case, claims, description) => {
    const result = await refusal(await call(gateOf(), bearer(sign(claims()))))
    expect(result).toEqual({ status: 401, error: "invalid_token", description })
  })

  // The leeway is for an IdP clock slightly ahead; exp stays exact (above).
  it("serves an nbf within the leeway and an iat ahead, refuses an nbf past it", async () => {
    const gate = gateOf()
    const within = sign({ ...good(), nbf: now() + NOT_BEFORE_LEEWAY_SECONDS - 5 })
    expect(await call(gate, bearer(within))).not.toBeInstanceOf(Response)
    expect(await call(gate, bearer(sign({ ...good(), iat: now() + 3600 })))).not.toBeInstanceOf(
      Response,
    )
    const past = sign({ ...good(), nbf: now() + NOT_BEFORE_LEEWAY_SECONDS + 60 })
    expect((await refusal(await call(gate, bearer(past)))).status).toBe(401)
  })
})

describe("the bearer gate: the RFC 8707 binding", () => {
  it.each<[string, unknown]>([
    ["a trailing slash", `${AUD}/`],
    ["an upper-case host", "http://LOCALHOST:1/mcp"],
    ["the bare origin", "http://localhost"],
    ["a list without it", ["account", "http://localhost"]],
  ])("refuses an aud with %s", async (_case, aud) => {
    const result = await refusal(await call(gateOf(), bearer(sign({ ...good(), aud }))))
    expect(result.description).toBe("Token audience does not include the protected resource")
  })

  it.each<[string, unknown]>([
    ["mixes in a number", [1, AUD]],
    ["mixes in null", [AUD, null]],
    ["is empty", []],
    ["is a number", 7],
    ["is missing", undefined],
  ])("refuses an aud that %s, whole", async (_case, aud) => {
    const result = await refusal(await call(gateOf(), bearer(sign({ ...good(), aud }))))
    expect(result.description).toBe("Token audience claim must be a string or string array")
  })

  it("serves an aud list that holds it among other strings", async () => {
    const token = sign({ ...good(), aud: ["account", AUD] })
    expect(await call(gateOf(), bearer(token))).not.toBeInstanceOf(Response)
  })

  // A resource claim binds on its own: it wins over aud, and must name exactly this server.
  it("serves a resource claim naming it (one trailing slash ignored), whatever aud says", async () => {
    const gate = gateOf()
    for (const resource of [AUD, `${AUD}/`]) {
      const token = sign({ ...good(), aud: "account", resource })
      expect(await call(gate, bearer(token)), resource).not.toBeInstanceOf(Response)
    }
  })

  it.each<[string, unknown, string]>([
    ["a number", 7, "Token resource claim must be an absolute URL"],
    ["no URL", "mcp", "Token resource claim must be an absolute URL"],
    ["a query", `${AUD}?a=1`, "Token resource claim does not match protected resource"],
    [
      "another server",
      "https://other.example/mcp",
      "Token resource claim does not match protected resource",
    ],
  ])("refuses a resource claim that is %s", async (_case, resource, description) => {
    const token = sign({ ...good(), aud: AUD, resource })
    expect((await refusal(await call(gateOf(), bearer(token)))).description).toBe(description)
  })
})

describe("the bearer gate: algorithms and keys", () => {
  it.each<[string, SignOptions]>([
    ["ES256 by the EC key", { key: ec.privateKey, alg: "ES256", kid: "e1" }],
    ["no kid, one key of its type", { kid: null }],
    ["typ at+jwt", { typ: "at+jwt" }],
  ])("serves %s", async (_case, options) => {
    expect(await call(gateOf(), bearer(sign(good(), options)))).not.toBeInstanceOf(Response)
  })

  // jose leaves a token without `kid` that several keys could have signed to the caller.
  it("tries each key of its type for a token without kid, and refuses one none of them signed", async () => {
    idp.keys = [JWK_RSA, JWK_RSA2]
    const gate = gateOf()
    const bySecond = sign(good(), { key: rsa2.privateKey, kid: null })
    expect(await call(gate, bearer(bySecond))).not.toBeInstanceOf(Response)
    const byNeither = sign(good(), { key: rsa3.privateKey, kid: null })
    expect(await refusal(await call(gate, bearer(byNeither)))).toMatchObject({
      status: 401,
      description: "JWT verification failed",
    })
  })

  it.each<[string, SignOptions]>([
    ["RS512 against an RS256 key", { alg: "RS512" }],
    ["PS256 against an RS256 key", { alg: "PS256" }],
    [
      "HS256 keyed with the public key",
      { alg: "HS256", key: rsa.publicKey.export({ type: "spki", format: "pem" }).toString() },
    ],
    ["alg none", { alg: "none" }],
    ["an unknown crit header", { header: { crit: ["x-unknown"], "x-unknown": 1 } }],
    ["a kid the key set lacks", { kid: "nope" }],
    ["another key's signature", { key: rsa2.privateKey }],
  ])("refuses %s: 401", async (_case, options) => {
    const result = await refusal(await call(gateOf(), bearer(sign(good(), options))))
    expect(result).toEqual({
      status: 401,
      error: "invalid_token",
      description: "JWT verification failed",
    })
  })

  it("refuses a token that is no JWT", async () => {
    expect((await refusal(await call(gateOf(), bearer("abc")))).status).toBe(401)
  })
})

describe("the bearer gate: the Authorization header", () => {
  it.each<[string, string | undefined, string]>([
    ["no header", undefined, "Missing Authorization header"],
    ["an empty header", "", "Missing Authorization header"],
    ["Basic", "Basic dTpw", "Invalid Authorization header format, expected 'Bearer TOKEN'"],
    [
      "Bearer without a token",
      "Bearer",
      "Invalid Authorization header format, expected 'Bearer TOKEN'",
    ],
  ])("answers %s with a 401 challenge naming the metadata", async (_case, header, description) => {
    const response = (await call(gateOf(), header)) as Response
    expect(response.status).toBe(401)
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer error="invalid_token", error_description="${description}", resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"`,
    )
  })

  it("takes the scheme in any case", async () => {
    const token = sign(good())
    expect(await call(gateOf(), `bearer ${token}`)).not.toBeInstanceOf(Response)
  })
})

describe("the bearer gate: the key set failing", () => {
  it.each<[Mode, string]>([
    ["500", "Expected 200 OK from the JSON Web Key Set HTTP response"],
    ["html", "Failed to parse the JSON Web Key Set HTTP response as JSON"],
    ["malformed", "JSON Web Key Set malformed"],
  ])(
    "answers 503 naming the key set when the IdP answers %s, never a pass",
    async (mode, reason) => {
      idp.mode = mode
      const response = (await call(gateOf(), bearer(sign(good())))) as Response
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({
        error: "temporarily_unavailable",
        error_description: `The identity provider's signing keys could not be loaded from ${idp.issuer}/protocol/openid-connect/certs (${reason}), so no token can be verified. Retry shortly.`,
      })
    },
  )

  it("answers 503 with the network error's code when the IdP is gone", async () => {
    const gone = await startIdp()
    await gone.close()
    const provider = oauthKeycloakProvider({ serverUrl: gone.url, realm: "platform" })
    const token = sign({ ...good(), iss: gone.issuer })
    const response = (await call(gateOf(provider), bearer(token))) as Response
    expect(response.status).toBe(503)
    expect(((await response.json()) as { error_description: string }).error_description).toMatch(
      /could not be loaded from .* \(fetch failed \(ECONNREFUSED\)\)/,
    )
  })

  it("keeps verifying with the keys it loaded while the IdP fails, until they are stale", async () => {
    const gate = gateOf()
    expect(await call(gate, bearer(sign(good())))).not.toBeInstanceOf(Response)
    idp.mode = "500"
    expect(await call(gate, bearer(sign(good())))).not.toBeInstanceOf(Response)
    // An unknown kid within the cooldown is the token's failure, not the IdP's.
    expect((await refusal(await call(gate, bearer(sign(good(), { kid: "k9" }))))).status).toBe(401)
  })
})

describe("MCP_OAUTH_DEBUG", () => {
  it("logs why a token was refused and the claims the checks read, never the token", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const token = sign({ ...good(), sub: undefined })
    await call(gateOf(keycloak(true)), bearer(token))
    const lines = error.mock.calls.map(([line]) => String(line))
    expect(lines[0]).toMatch(/^\[oauth-debug\] JWT verify failed: JWTClaimValidationFailed: /)
    expect(lines).toContain("[oauth-debug] claim=sub reason=missing")
    const summary = JSON.parse(lines[2].replace("[oauth-debug] token=", "")) as Record<
      string,
      unknown
    >
    expect(summary).toMatchObject({
      header: { alg: "RS256", kid: "k1", typ: "JWT" },
      iss: idp.issuer,
      aud: AUD,
      sub: "missing",
    })
    expect(lines.join("\n")).not.toContain(token.split(".")[2])
  })

  it("logs an audience refusal with the token's aud, and a token that is no JWT as such", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const gate = gateOf(keycloak(true))
    await call(gate, bearer(sign({ ...good(), aud: "http://localhost" })))
    await call(gate, bearer("abc"))
    const lines = error.mock.calls.map(([line]) => String(line))
    expect(lines).toContain(
      "[oauth-debug] JWT verify failed: OAuthError: Token audience does not include the protected resource",
    )
    expect(lines.some((line) => line.includes('"aud":"http://localhost"'))).toBe(true)
    expect(lines.some((line) => line.includes('"sub":"set"'))).toBe(true)
    expect(lines).toContain("[oauth-debug] token=not a decodable JWT")
  })

  it("logs nothing without the switch", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    await call(gateOf(keycloak(false)), bearer(sign({ ...good(), sub: undefined })))
    expect(error).not.toHaveBeenCalled()
  })
})
