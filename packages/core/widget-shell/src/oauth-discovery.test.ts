import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Platform } from "@miragon/pulse-http"
import { DISCOVERY_HOLD_MS, metadataSource } from "./oauth-discovery.js"
import { startFakeOidc, type FakeOidc } from "./testing/oidc/index.js"

const ISSUER = "https://idp.example.test/realms/pulse"
const OIDC_URL = `${ISSUER}/.well-known/openid-configuration`
const RFC8414_URL = "https://idp.example.test/.well-known/oauth-authorization-server/realms/pulse"

const DOCUMENT = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/auth`,
  token_endpoint: `${ISSUER}/token`,
  code_challenge_methods_supported: ["S256"],
}

interface Stub {
  readonly platform: Platform
  readonly asked: string[]
  readonly logged: string[]
  advance(ms: number): void
}

/** A platform whose fetch answers each URL from `answers`, and a clock the test moves. */
function stub(answers: Record<string, () => Response>): Stub {
  let now = 1_800_000_000_000
  const asked: string[] = []
  const fetch = (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    asked.push(url)
    const answer = answers[url]
    return answer ? Promise.resolve(answer()) : Promise.reject(new TypeError("fetch failed"))
  }
  return {
    platform: { fetch, now: () => now },
    asked,
    logged: [],
    advance: (ms) => {
      now += ms
    },
  }
}

const jsonAnswer =
  (body: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const sourceOf = ({ platform, logged }: Stub, issuer = ISSUER) =>
  metadataSource(issuer, platform, (line) => logged.push(line))

describe("metadataSource", () => {
  it("reads the metadata on the first request, not before", async () => {
    const io = stub({ [OIDC_URL]: jsonAnswer(DOCUMENT) })
    const metadata = sourceOf(io)
    expect(io.asked).toEqual([])
    expect(await metadata()).toEqual({
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/auth`,
      tokenEndpoint: `${ISSUER}/token`,
      issParameterRequired: false,
      clientAuth: "basic",
    })
    expect(io.asked).toEqual([OIDC_URL])
    expect(io.logged).toEqual([])
  })

  it("holds what it found for an hour, then reads again", async () => {
    const io = stub({ [OIDC_URL]: jsonAnswer(DOCUMENT) })
    const metadata = sourceOf(io)
    await metadata()
    io.advance(DISCOVERY_HOLD_MS - 1)
    await metadata()
    expect(io.asked).toHaveLength(1)
    io.advance(1)
    await metadata()
    expect(io.asked).toHaveLength(2)
  })

  it("reads once for the requests that wait at the same time", async () => {
    const io = stub({ [OIDC_URL]: jsonAnswer(DOCUMENT) })
    const metadata = sourceOf(io)
    const found = await Promise.all([metadata(), metadata(), metadata()])
    expect(new Set(found).size).toBe(1)
    expect(io.asked).toEqual([OIDC_URL])
  })

  it("holds no failure: the next request reads again", async () => {
    let answer = jsonAnswer({}, 503)
    const io = stub({ [OIDC_URL]: () => answer() })
    const metadata = sourceOf(io)
    expect(await metadata()).toBeUndefined()
    answer = jsonAnswer(DOCUMENT)
    expect(await metadata()).toMatchObject({ issuer: ISSUER })
    expect(io.asked).toEqual([OIDC_URL, OIDC_URL])
  })

  it.each([
    ["no answer at all", {}, "no answer (unreachable)"],
    ["a refusal", { [OIDC_URL]: jsonAnswer({}, 503) }, `${OIDC_URL} answered 503`],
    [
      "the RFC 8414 location's refusal after the OpenID Connect one's 404",
      { [OIDC_URL]: jsonAnswer({}, 404), [RFC8414_URL]: jsonAnswer({}, 404) },
      `${RFC8414_URL} answered 404`,
    ],
    [
      "no JSON object",
      { [OIDC_URL]: () => new Response("<html>", { headers: { "content-type": "text/html" } }) },
      `${OIDC_URL} answered no JSON object`,
    ],
    [
      "another issuer",
      { [OIDC_URL]: jsonAnswer({ ...DOCUMENT, issuer: "https://evil.example" }) },
      "the document cannot be used (other-issuer)",
    ],
    [
      "no PKCE with S256",
      { [OIDC_URL]: jsonAnswer({ ...DOCUMENT, code_challenge_methods_supported: ["plain"] }) },
      "the document cannot be used (no-pkce)",
    ],
    [
      "an endpoint over plain http off the machine",
      { [OIDC_URL]: jsonAnswer({ ...DOCUMENT, token_endpoint: "http://idp.example.test/token" }) },
      "the document cannot be used (endpoint-url)",
    ],
  ])("reads nothing from %s, and says so in the log", async (_case, answers, why) => {
    const io = stub(answers)
    expect(await sourceOf(io)()).toBeUndefined()
    expect(io.logged).toEqual([
      `Web sign-in: the discovery of ${ISSUER} failed: ${why}. Until it answers, a sign-in ends on the signed-out page.`,
    ])
  })

  it("names the error of an issuer it cannot even ask", async () => {
    const io = stub({})
    expect(await sourceOf(io, "ftp://idp.example.test")()).toBeUndefined()
    expect(io.logged[0]).toContain(
      "failed: no answer (the authorization server URL must use http or https).",
    )
    expect(io.asked).toEqual([])
  })
})

describe("metadataSource against the fake identity provider", () => {
  let fake: FakeOidc
  beforeEach(async () => {
    fake = await startFakeOidc()
  })
  afterEach(() => fake.close())

  it("takes its endpoints on the machine itself over plain http", async () => {
    const platform: Platform = { fetch: (input, init) => fetch(input, init), now: () => Date.now() }
    const metadata = await metadataSource(fake.issuer, platform, () => {})()
    expect(metadata).toEqual({
      issuer: fake.issuer,
      authorizationEndpoint: `${fake.issuer}/protocol/openid-connect/auth`,
      tokenEndpoint: `${fake.issuer}/protocol/openid-connect/token`,
      revocationEndpoint: `${fake.issuer}/protocol/openid-connect/revoke`,
      endSessionEndpoint: `${fake.issuer}/protocol/openid-connect/logout`,
      issParameterRequired: true,
      clientAuth: "basic",
    })
  })
})
