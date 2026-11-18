import { describe, expect, it } from "vitest"
import {
  DISCOVERY_HOLD_MS,
  NO_DOCUMENT_HOLD_MS,
  providerDiscovery,
  STALE_LIMIT_MS,
  UNUSABLE_HOLD_MS,
} from "./oauth-discovery.js"

/**
 * The provider's one discovery with both halves: the gate's key metadata beside the web sign-in's
 * metadata, each checked by its own needs, one read shared, and the gate's words for what it misses.
 */

const ISSUER = "https://idp.example.test/adfs"
const OIDC_URL = `${ISSUER}/.well-known/openid-configuration`
const TRUST = "http://idp.example.test/adfs/services/trust"

const DOCUMENT = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/oauth2/authorize/`,
  token_endpoint: `${ISSUER}/oauth2/token/`,
  jwks_uri: `${ISSUER}/discovery/keys`,
  access_token_issuer: TRUST,
}

type Answer = () => Response | Promise<Response>

const json =
  (body: unknown, status = 200): Answer =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** The provider as its discovery answers it, on a clock the test moves; a request waits for `gate`. */
class Provider {
  answer: Answer = json(DOCUMENT)
  readonly asked: string[] = []
  readonly logged: string[] = []
  private time = 1_800_000_000_000
  readonly discovery

  constructor(issuer = ISSUER) {
    this.discovery = providerDiscovery(
      issuer,
      {
        fetch: (input) => {
          this.asked.push(String(input instanceof Request ? input.url : input))
          return Promise.resolve(this.answer())
        },
        now: () => this.time,
      },
      (line) => this.logged.push(line),
    )
  }

  advance(ms: number): void {
    this.time += ms
  }
}

const gateLine = (why: string, issuer = ISSUER) =>
  `OAuth: the discovery of ${issuer} failed: ${why}. Until it answers, /mcp answers 503 (temporarily_unavailable).`

describe("providerDiscovery: the gate's half", () => {
  it("finds the key set and the access tokens' issuer", async () => {
    const idp = new Provider()
    expect(await idp.discovery.keys()).toEqual({
      issuer: ISSUER,
      jwksUri: `${ISSUER}/discovery/keys`,
      accessTokenIssuer: TRUST,
    })
    expect(idp.logged).toEqual([])
  })

  it("has the keys of a provider whose clients sign in by private_key_jwt alone, which the sign-in cannot use", async () => {
    const idp = new Provider()
    idp.answer = json({ ...DOCUMENT, token_endpoint_auth_methods_supported: ["private_key_jwt"] })
    expect(await idp.discovery.keys()).toMatchObject({ jwksUri: `${ISSUER}/discovery/keys` })
    expect(await idp.discovery.server()).toBeUndefined()
    expect(idp.logged).toEqual([
      `Web sign-in: the discovery of ${ISSUER} failed: the document cannot be used (client-auth). Until it answers, a sign-in ends on the signed-out page.`,
    ])
  })

  it("has the sign-in's metadata of a provider whose document names no key set, and the gate none", async () => {
    const idp = new Provider()
    const withoutKeys: Record<string, unknown> = { ...DOCUMENT }
    delete withoutKeys.jwks_uri
    idp.answer = json(withoutKeys)
    expect(await idp.discovery.server()).toMatchObject({ issuer: ISSUER })
    expect(await idp.discovery.keys()).toBeUndefined()
    expect(idp.logged).toEqual([gateLine("the document names no jwks_uri")])
  })

  it.each<[string, Record<string, unknown>, string]>([
    [
      "another issuer",
      { issuer: "https://evil.example.test" },
      "the document cannot be used (other-issuer)",
    ],
    ["no issuer", { issuer: undefined }, "the document cannot be used (no-issuer)"],
    [
      "plain http",
      { jwks_uri: "http://idp.example.test/keys" },
      "its jwks_uri cannot be used (insecure)",
    ],
    [
      "credentials",
      { jwks_uri: "https://user:secret@idp.example.test/keys" },
      "its jwks_uri cannot be used (credentials)",
    ],
    ["no URL", { jwks_uri: "keys" }, "its jwks_uri cannot be used (not-a-url)"],
    ["a fragment", { jwks_uri: `${ISSUER}/keys#a` }, "its jwks_uri cannot be used (fragment)"],
    [
      "a loopback key set of a remote issuer",
      { jwks_uri: "http://127.0.0.1:8080/keys" },
      "its jwks_uri is on this machine, and the issuer is not",
    ],
  ])("refuses a document with %s, in words that name no secret", async (_case, change, why) => {
    const idp = new Provider()
    idp.answer = json({ ...DOCUMENT, ...change })
    expect(await idp.discovery.keys()).toBeUndefined()
    expect(idp.logged).toEqual([gateLine(why)])
    expect(idp.logged.join("\n")).not.toContain("secret")
  })

  it("takes a loopback key set of a loopback issuer", async () => {
    const issuer = "http://127.0.0.1:9000/adfs"
    const idp = new Provider(issuer)
    idp.answer = json({ issuer, jwks_uri: `${issuer}/discovery/keys` })
    expect(await idp.discovery.keys()).toEqual({ issuer, jwksUri: `${issuer}/discovery/keys` })
  })

  it.each<[string, Answer, string]>([
    ["a refusal", json({}, 503), `${OIDC_URL} answered 503`],
    ["no JSON object", () => new Response("<html>"), `${OIDC_URL} answered no JSON object`],
  ])("says so on %s, and reads again at the first token 5 s later", async (_case, answer, why) => {
    const idp = new Provider()
    idp.answer = answer
    expect(await idp.discovery.keys()).toBeUndefined()
    expect(idp.logged).toEqual([gateLine(why)])
    idp.answer = json(DOCUMENT)
    idp.advance(NO_DOCUMENT_HOLD_MS - 1)
    expect(await idp.discovery.keys()).toBeUndefined()
    expect(idp.asked).toHaveLength(1)
    idp.advance(1)
    expect(await idp.discovery.keys()).toMatchObject({ issuer: ISSUER })
    expect(idp.asked).toHaveLength(2)
  })

  it("reads once and logs once for the bearer tokens of strangers within the hold", async () => {
    const idp = new Provider()
    idp.answer = json({}, 503)
    for (let token = 0; token < 50; token += 1) {
      expect(await idp.discovery.keys()).toBeUndefined()
      idp.advance(NO_DOCUMENT_HOLD_MS / 50)
    }
    expect(idp.asked).toEqual([OIDC_URL])
    expect(idp.logged).toEqual([gateLine(`${OIDC_URL} answered 503`)])
    expect(await idp.discovery.keys()).toBeUndefined()
    expect(idp.asked).toHaveLength(2)
    expect(idp.logged).toHaveLength(1)
  })

  it("holds a document whose key set it cannot use a minute, as a setting that will not heal soon", async () => {
    const idp = new Provider()
    idp.answer = json({ ...DOCUMENT, issuer: "https://evil.example.test" })
    expect(await idp.discovery.keys()).toBeUndefined()
    idp.answer = json(DOCUMENT)
    idp.advance(UNUSABLE_HOLD_MS - 1)
    expect(await idp.discovery.keys()).toBeUndefined()
    expect(idp.asked).toHaveLength(1)
    idp.advance(1)
    expect(await idp.discovery.keys()).toMatchObject({ issuer: ISSUER })
    expect(idp.logged).toEqual([gateLine("the document cannot be used (other-issuer)")])
  })

  it("keeps the key set it found when a re-read fails, and says so at each re-read", async () => {
    const idp = new Provider()
    const found = await idp.discovery.keys()
    idp.answer = json({}, 500)
    idp.advance(DISCOVERY_HOLD_MS)
    expect(await idp.discovery.keys()).toBe(found)
    idp.advance(DISCOVERY_HOLD_MS)
    expect(await idp.discovery.keys()).toBe(found)
    const line = `OAuth: the discovery of ${ISSUER} failed: ${OIDC_URL} answered 500. It keeps the key set it found last and reads again in an hour.`
    expect(idp.logged).toEqual([line, line])
  })

  it("drops the key set a day after its last good read, and /mcp answers 503 again", async () => {
    const idp = new Provider()
    await idp.discovery.keys()
    idp.answer = json({ ...DOCUMENT, issuer: "https://evil.example.test" })
    idp.advance(STALE_LIMIT_MS - DISCOVERY_HOLD_MS)
    expect(await idp.discovery.keys()).toMatchObject({ issuer: ISSUER })
    idp.advance(DISCOVERY_HOLD_MS)
    expect(await idp.discovery.keys()).toBeUndefined()
    expect(idp.logged.at(-1)).toBe(
      `OAuth: the discovery of ${ISSUER} failed: the document cannot be used (other-issuer). Its last good read is a day old, so it drops the key set it kept: until it answers, /mcp answers 503 (temporarily_unavailable).`,
    )
  })
})

describe("providerDiscovery: one discovery for both halves", () => {
  it("reads once for both halves when they ask at the same time", async () => {
    const idp = new Provider()
    const [server, keys] = await Promise.all([idp.discovery.server(), idp.discovery.keys()])
    expect(server).toMatchObject({ issuer: ISSUER })
    expect(keys).toMatchObject({ issuer: ISSUER })
    expect(idp.asked).toEqual([OIDC_URL])
  })

  it("serves the other half with a document read within the hour, and both read anew an hour after it", async () => {
    const idp = new Provider()
    await idp.discovery.keys()
    idp.advance(DISCOVERY_HOLD_MS - 1)
    expect(await idp.discovery.server()).toMatchObject({ issuer: ISSUER })
    expect(idp.asked).toHaveLength(1)
    idp.advance(1)
    idp.answer = json({ ...DOCUMENT, jwks_uri: `${ISSUER}/discovery/keys2` })
    await idp.discovery.server()
    expect(idp.asked).toHaveLength(2)
    expect(await idp.discovery.keys()).toMatchObject({ jwksUri: `${ISSUER}/discovery/keys2` })
    expect(idp.asked).toHaveLength(2)
    idp.advance(DISCOVERY_HOLD_MS - 1)
    await Promise.all([idp.discovery.server(), idp.discovery.keys()])
    expect(idp.asked).toHaveLength(2)
  })

  it("reads anew, a minute later, for a half that could not use the document the other half read", async () => {
    const idp = new Provider()
    idp.answer = json({ ...DOCUMENT, token_endpoint_auth_methods_supported: ["private_key_jwt"] })
    await idp.discovery.keys()
    expect(await idp.discovery.server()).toBeUndefined()
    expect(idp.asked).toHaveLength(1)
    idp.answer = json(DOCUMENT)
    idp.advance(UNUSABLE_HOLD_MS)
    expect(await idp.discovery.server()).toMatchObject({ issuer: ISSUER })
    expect(idp.asked).toHaveLength(2)
    expect(await idp.discovery.keys()).toMatchObject({ issuer: ISSUER })
    expect(idp.asked).toHaveLength(2)
  })

  it("serves no document an hour old to the other half's first request", async () => {
    const idp = new Provider()
    await idp.discovery.keys()
    idp.advance(DISCOVERY_HOLD_MS)
    await idp.discovery.server()
    expect(idp.asked).toHaveLength(2)
  })

  it("reads anew after a failed read for a half that checked the document read before", async () => {
    const idp = new Provider()
    idp.answer = json({ ...DOCUMENT, token_endpoint_auth_methods_supported: ["private_key_jwt"] })
    await idp.discovery.keys()
    await idp.discovery.server()
    idp.answer = json({}, 503)
    idp.advance(UNUSABLE_HOLD_MS)
    await idp.discovery.server()
    expect(idp.asked).toHaveLength(2)
    idp.answer = json(DOCUMENT)
    idp.advance(NO_DOCUMENT_HOLD_MS)
    expect(await idp.discovery.server()).toMatchObject({ issuer: ISSUER })
    expect(idp.asked).toHaveLength(3)
  })

  it("keeps no failure for the other half", async () => {
    const idp = new Provider()
    idp.answer = json({}, 503)
    expect(await idp.discovery.keys()).toBeUndefined()
    idp.answer = json(DOCUMENT)
    expect(await idp.discovery.server()).toMatchObject({ issuer: ISSUER })
    expect(idp.asked).toHaveLength(2)
  })
})
