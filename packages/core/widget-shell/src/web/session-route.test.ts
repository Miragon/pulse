import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import { SESSION_COOKIE } from "./cookies.js"
import { createSealer } from "./seal.js"
import {
  bootWeb,
  Browser,
  FLAGS,
  HOUR,
  KEY,
  RESOURCE,
  signIn,
  webEnv,
} from "./sign-in.test-support.js"

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

const SIGNED_OUT = { code: "signed_out", message: "No session: sign in again." }

describe("GET /app/api/session", () => {
  it("names who signed in, the CSRF token and when the session ends, and no token", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const before = Date.now()
    await signIn(browser, fake)
    const response = await browser.fetch("/app/api/session")
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    expect(response.headers.get("content-type")).toBe("application/json")
    const text = await response.text()
    const body = JSON.parse(text) as { name: string; csrf: string; expiresAt: number }
    expect(Object.keys(body)).toEqual(["name", "csrf", "expiresAt"])
    expect(body.name).toBe("Alice Adams")
    expect(body.csrf).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + 8 * HOUR)
    expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + 8 * HOUR)
    for (const token of [...fake.issued.access, ...fake.issued.refresh, ...fake.issued.id]) {
      expect(text).not.toContain(token)
    }
  })

  it("lasts as long as MCP_WEB_SESSION_HOURS says", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake, { MCP_WEB_SESSION_HOURS: "2" })))
    const callback = await signIn(browser, fake)
    expect(callback.headers.getSetCookie()[0]).toContain("; Max-Age=7200; ")
  })

  it("answers 401 signed_out without a session, and sets no cookie", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const response = await browser.fetch("/app/api/session")
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(SIGNED_OUT)
    expect(response.headers.getSetCookie()).toEqual([])
  })

  it("answers 401 to a session past its expiry and clears its cookies", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const session = { id: "s", csrf: "c", name: "n", tokens: { accessToken: "a", receivedAt: 1 } }
    const sealed = await createSealer([KEY]).seal(SESSION_COOKIE, session, Date.now() - 1)
    browser.cookies.set(SESSION_COOKIE, sealed)
    const response = await browser.fetch("/app/api/session")
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(SIGNED_OUT)
    expect(response.headers.getSetCookie()).toEqual(
      [SESSION_COOKIE, `${SESSION_COOKIE}.1`, `${SESSION_COOKIE}.2`].map(
        (name) => `${name}=; Max-Age=0; ${FLAGS}`,
      ),
    )
  })

  it("opens a session sealed by a key the server still holds, after it rotated", async () => {
    const old = new Uint8Array(32).fill(8)
    const session = {
      id: "s",
      csrf: "c",
      name: "Rotated",
      tokens: { accessToken: "a", receivedAt: 1 },
    }
    const sealed = await createSealer([old]).seal(SESSION_COOKIE, session, Date.now() + HOUR)
    const keys = [KEY, old].map((key) => Buffer.from(key).toString("base64url")).join(",")
    const browser = new Browser(await bootWeb(webEnv(fake, { MCP_WEB_SESSION_KEYS: keys })))
    browser.cookies.set(SESSION_COOKIE, sealed)
    const response = await browser.fetch("/app/api/session")
    expect(await response.json()).toMatchObject({ name: "Rotated", csrf: "c" })
  })
})
