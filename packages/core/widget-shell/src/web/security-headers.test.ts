import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import { createHash } from "node:crypto"
import { INDEX_HTML, STYLESHEET, STYLESHEET_CSS } from "./build.test-support.js"
import { WEB_CSP, webSecurityHeaders } from "./security-headers.js"
import { bootWeb, Browser, RESOURCE, webEnv } from "./sign-in.test-support.js"

let fake: FakeOidc

beforeEach(async () => {
  fake = await startFakeOidc({ audience: RESOURCE })
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

const SECURED = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
}

const HSTS = { "strict-transport-security": "max-age=31536000" }

const headersOf = (response: Response) => Object.fromEntries(response.headers)

/** The security headers of an answer, by their names. */
const securedOf = (response: Response) =>
  Object.fromEntries([...response.headers].filter(([name]) => name in SECURED || name in HSTS))

describe("webSecurityHeaders", () => {
  it("names the policy and the headers of every answer under /app, HSTS only on https", () => {
    expect(WEB_CSP).toBe(SECURED["content-security-policy"])
    expect(webSecurityHeaders("http://localhost:8400")).toEqual(SECURED)
    expect(webSecurityHeaders("https://pulse.example.test")).toEqual({ ...SECURED, ...HSTS })
  })
})

describe("the security headers under /app", () => {
  it("are exactly these on the page and on an asset, with the type, the length, the cache policy and an asset's tag", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    expect(headersOf(await browser.fetch("/app/signed-out"))).toEqual({
      ...SECURED,
      "content-type": "text/html; charset=utf-8",
      "content-length": String(Buffer.byteLength(INDEX_HTML)),
      "cache-control": "no-store",
    })
    expect(headersOf(await browser.fetch(STYLESHEET))).toEqual({
      ...SECURED,
      "content-type": "text/css; charset=utf-8",
      "content-length": String(Buffer.byteLength(STYLESHEET_CSS)),
      "cache-control": "public, max-age=31536000, immutable",
      etag: `"${createHash("sha256").update(STYLESHEET_CSS).digest("base64url")}"`,
      vary: "Accept-Encoding",
      "accept-ranges": "none",
    })
  })

  it("go out on every answer under /app: a redirect, a refusal, a 404, the API's", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const answers = [
      await browser.fetch("/app"),
      await browser.fetch("/app/auth/login"),
      await browser.fetch("/app/api/session"),
      await browser.fetch("/app/nothing"),
      await browser.fetch("/app/assets/missing.css"),
      await browser.fetch("/app/cockpit", { headers: { authorization: "Bearer x" } }),
      await browser.fetch(STYLESHEET, { method: "HEAD" }),
    ]
    expect(answers.map((response) => response.status)).toEqual([302, 302, 401, 404, 404, 400, 200])
    for (const response of answers) expect(securedOf(response), response.url).toEqual(SECURED)
  })

  it("stay off every other route", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    for (const target of ["/health", "/apple", "/mcp", "/fonts/x"]) {
      expect(securedOf(await browser.fetch(target)), target).toEqual({})
    }
  })

  it("add HSTS where MCP_URL is https, for its host alone", async () => {
    const app = await bootWeb(webEnv(fake, { MCP_URL: "https://pulse.example.test" }))
    const response = await app.fetch(
      new Request("https://pulse.example.test/app/signed-out", {
        headers: { host: "pulse.example.test" },
      }),
    )
    expect(response.status).toBe(200)
    expect(securedOf(response)).toEqual({ ...SECURED, ...HSTS })
  })
})
