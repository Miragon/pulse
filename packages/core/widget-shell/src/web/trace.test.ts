import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import {
  bootWeb,
  Browser,
  ORIGIN,
  RESOURCE,
  sessionOf,
  startSignIn,
  webEnv,
} from "./sign-in.test-support.js"

/**
 * The request log at `MCP_LOG_LEVEL=trace` over the web app: whoever reads it learns no secret of a
 * sign-in under way (its state and PKCE challenge, with which a reader who can sign in at the
 * provider would finish a victim's sign-in as themselves), of a session (its CSRF token) or of the
 * provider (a code, a token).
 */

let fake: FakeOidc
let logged: MockInstance<(line: string) => void>

beforeEach(async () => {
  fake = await startFakeOidc({ audience: RESOURCE })
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  logged = vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

describe("the request log at trace over the web app", () => {
  it("shows no sign-in's state or challenge, no CSRF token, no code and no token", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake, { MCP_LOG_LEVEL: "trace" })))
    const { authorization } = await startSignIn(browser, fake)
    const query = new URL(authorization).searchParams
    const callback = await fake.signIn(authorization)
    expect((await browser.fetch(callback)).status).toBe(303)
    const csrf = String((await sessionOf(browser)).body.csrf)
    const headers = { origin: ORIGIN, "sec-fetch-site": "same-origin", "x-pulse-csrf": csrf }
    const body = JSON.stringify({ name: "probe_tool", arguments: {} })
    await browser.fetch("/app/api/call", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
    })
    expect((await browser.logout(csrf)).status).toBe(200)

    const log = logged.mock.calls.map(([line]) => String(line)).join("\n")
    expect(log).toMatch(/GET \/app\/auth\/login 302 /)
    expect(log).toContain('"x-pulse-csrf": "[REDACTED]"')
    const secrets = [
      query.get("state"),
      query.get("code_challenge"),
      new URL(callback).searchParams.get("code"),
      csrf,
      ...fake.issued.access,
      ...fake.issued.refresh,
      ...fake.issued.id,
    ]
    for (const secret of secrets) {
      expect(secret).toBeTruthy()
      expect(log).not.toContain(secret)
    }
  })
})
