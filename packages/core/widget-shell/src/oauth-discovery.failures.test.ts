import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  DISCOVERY_HOLD_MS,
  metadataSource,
  NO_DOCUMENT_HOLD_MS,
  providerDiscovery,
  STALE_LIMIT_MS,
} from "./oauth-discovery.js"
import { oauthGate } from "./oauth-gate.js"
import { createJwtVerifier } from "./oauth-jwt.js"
import { now, sign, startIdp, type Idp } from "./oauth-jwt.test-support.js"
import { oauthCustomProvider } from "./oauth-providers.js"

/**
 * The discovery when the provider fails: a failed re-read keeps what it found (stale-if-error) for
 * a day after the last good read, a failure never rejects, and a gate that waits for the discovery
 * answers 503 meanwhile.
 */

const ISSUER = "https://idp.example.test/realms/pulse"
const OIDC_URL = `${ISSUER}/.well-known/openid-configuration`

const DOCUMENT = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
}

type Answer = () => Response | Promise<Response>

const json =
  (body: unknown, status = 200): Answer =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const unreachable: Answer = () => Promise.reject(new TypeError("fetch failed"))

/** The provider as its discovery answers it: `answer` for every request, on a clock the test moves. */
class Provider {
  answer: Answer = json(DOCUMENT)
  readonly asked: string[] = []
  readonly logged: string[] = []
  private time = 1_800_000_000_000
  readonly metadata = metadataSource(
    ISSUER,
    {
      fetch: (input) => {
        this.asked.push(String(input instanceof Request ? input.url : input))
        return Promise.resolve(this.answer())
      },
      now: () => this.time,
    },
    (line) => this.logged.push(line),
  )

  advance(ms: number): void {
    this.time += ms
  }
}

const keptLine = (why: string) =>
  `Web sign-in: the discovery of ${ISSUER} failed: ${why}. It keeps the metadata it found last and reads again in an hour.`

describe("metadataSource after a failed re-read", () => {
  it.each<[string, Answer, string]>([
    ["no answer at all", unreachable, "no answer (unreachable)"],
    ["a refusal", json({}, 503), `${OIDC_URL} answered 503`],
    [
      "a document it cannot use",
      json({ ...DOCUMENT, issuer: "https://evil.example" }),
      "the document cannot be used (other-issuer)",
    ],
    [
      "a token endpoint that takes no client secret",
      json({ ...DOCUMENT, token_endpoint_auth_methods_supported: ["private_key_jwt"] }),
      "the document cannot be used (client-auth)",
    ],
  ])(
    "keeps what it found on %s, holds it another hour and says so at each re-read",
    async (_, answer, why) => {
      const idp = new Provider()
      const found = await idp.metadata()
      idp.answer = answer
      idp.advance(DISCOVERY_HOLD_MS)
      expect(await idp.metadata()).toBe(found)
      expect(idp.logged).toEqual([keptLine(why)])
      idp.advance(DISCOVERY_HOLD_MS - 1)
      expect(await idp.metadata()).toBe(found)
      expect(idp.asked).toEqual([OIDC_URL, OIDC_URL])
      idp.advance(1)
      expect(await idp.metadata()).toBe(found)
      expect(idp.asked).toHaveLength(3)
      expect(idp.logged).toEqual([keptLine(why), keptLine(why)])
    },
  )

  it("says each failed re-read in its own words, also when the reason changes", async () => {
    const idp = new Provider()
    await idp.metadata()
    idp.answer = json({}, 503)
    idp.advance(DISCOVERY_HOLD_MS)
    await idp.metadata()
    idp.answer = json({ ...DOCUMENT, issuer: "https://evil.example" })
    idp.advance(DISCOVERY_HOLD_MS)
    await idp.metadata()
    expect(idp.logged).toEqual([
      keptLine(`${OIDC_URL} answered 503`),
      keptLine("the document cannot be used (other-issuer)"),
    ])
  })

  it("keeps what it found until a day after its last good read, then drops it and holds the failure", async () => {
    const idp = new Provider()
    const found = await idp.metadata()
    idp.answer = json({}, 503)
    idp.advance(DISCOVERY_HOLD_MS)
    expect(await idp.metadata()).toBe(found)
    idp.advance(STALE_LIMIT_MS - 2 * DISCOVERY_HOLD_MS)
    expect(await idp.metadata()).toBe(found)
    idp.advance(DISCOVERY_HOLD_MS)
    expect(await idp.metadata()).toBeUndefined()
    const why = `${OIDC_URL} answered 503`
    expect(idp.logged).toEqual([
      keptLine(why),
      keptLine(why),
      `Web sign-in: the discovery of ${ISSUER} failed: ${why}. Its last good read is a day old, so it drops the metadata it kept: until it answers, a sign-in ends on the signed-out page.`,
    ])
    idp.answer = json(DOCUMENT)
    idp.advance(NO_DOCUMENT_HOLD_MS - 1)
    expect(await idp.metadata()).toBeUndefined()
    expect(idp.asked).toHaveLength(4)
    idp.advance(1)
    expect(await idp.metadata()).toMatchObject({ issuer: ISSUER })
    expect(idp.asked).toHaveLength(5)
  })

  it("counts the day from the last good read, which each found answer renews", async () => {
    const idp = new Provider()
    await idp.metadata()
    idp.advance(STALE_LIMIT_MS - DISCOVERY_HOLD_MS)
    const renewed = await idp.metadata()
    idp.answer = unreachable
    idp.advance(STALE_LIMIT_MS - 1)
    expect(await idp.metadata()).toBe(renewed)
    idp.advance(1 + DISCOVERY_HOLD_MS)
    expect(await idp.metadata()).toBeUndefined()
  })

  it("reads once for the requests that wait on a failing re-read, and gives each what it found", async () => {
    const idp = new Provider()
    const found = await idp.metadata()
    idp.answer = unreachable
    idp.advance(DISCOVERY_HOLD_MS)
    expect(await Promise.all([idp.metadata(), idp.metadata()])).toEqual([found, found])
    expect(idp.asked).toHaveLength(2)
  })
})

describe("metadataSource never rejects", () => {
  it.each<[string, Answer]>([
    [
      "a fetch that throws",
      () => {
        throw new TypeError("fetch failed")
      },
    ],
    // A thenable that fails with a string, as a library might.
    [
      "a fetch that fails with no Error",
      () => ({ then: (_: unknown, fail: (why: string) => void) => fail("down") }) as never,
    ],
  ])("on %s it reads nothing and says so in the log", async (_, answer) => {
    const idp = new Provider()
    idp.answer = answer
    await expect(idp.metadata()).resolves.toBeUndefined()
    expect(idp.logged).toEqual([
      `Web sign-in: the discovery of ${ISSUER} failed: no answer (unreachable). Until it answers, a sign-in ends on the signed-out page.`,
    ])
  })
})

describe("a gate that finds its key set once the discovery's gate half answers", () => {
  const RESOURCE = new URL("http://localhost/mcp")
  let keys: Idp
  beforeAll(async () => {
    keys = await startIdp()
  })
  afterAll(() => keys.close())

  it("answers 503 while the discovery fails at the first token, never 500, then verifies", async () => {
    let answer = unreachable
    let time = 1_800_000_000_000
    const logged: string[] = []
    const issuer = keys.issuer
    const discovery = providerDiscovery(
      issuer,
      { fetch: () => Promise.resolve(answer()), now: () => time },
      (line) => logged.push(line),
    )
    const provider = oauthCustomProvider({
      oauthMetadata: { issuer },
      createTokenVerifier: (resource) =>
        createJwtVerifier({
          keySets: [
            {
              issuer,
              jwks: async () => {
                const found = await discovery.keys()
                return found && new URL(found.jwksUri)
              },
            },
          ],
          resource,
        }),
      mapAuthInfo: () => ({ user: { id: "u1" }, payload: { sub: "u1" }, permissions: [] }),
    })
    const onUnexpected = vi.fn()
    const gate = oauthGate(provider, RESOURCE, onUnexpected)
    const token = sign({ iss: issuer, aud: RESOURCE.href, sub: "u1", exp: now() + 3600 })
    const call = () =>
      gate(new Request(RESOURCE, { headers: { authorization: `Bearer ${token}` } }))
    const refused = (await call()) as Response
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({
      error: "temporarily_unavailable",
      error_description: `The signing keys of ${issuer} are not known yet, so no token can be verified. Retry shortly.`,
    })
    expect(logged).toHaveLength(1)
    answer = json({ issuer, jwks_uri: `${keys.url}/keys` })
    time += NO_DOCUMENT_HOLD_MS
    expect(await call()).toMatchObject({ token, resource: RESOURCE })
    expect(onUnexpected).not.toHaveBeenCalled()
  })
})
