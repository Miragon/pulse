import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Platform } from "@miragon/pulse-http"
import { startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import { ENDED_COOKIE, endedCookie, SESSION_COOKIE } from "./cookies.js"
import type { McpHttpApp } from "../mcp-server.js"
import { createSealer } from "./seal.js"
import { requestSession, type SessionTokens, type WebSession } from "./session.js"
import {
  bootWeb,
  Browser,
  HOUR,
  KEY,
  RESOURCE,
  requestTo,
  sessionOf,
  signIn,
  webContext,
  webEnv,
} from "./sign-in.test-support.js"

/**
 * A session refused as signed out (the replica's record, or the browser's ended cookie) has its
 * refresh token revoked behind the answer, once per token at a replica: the token a call under way
 * on another replica renewed after the sign-out, which the sign-out never saw, renews nowhere once
 * the browser that signed out comes back, nor does a copy of its cookie.
 */

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

const sealer = createSealer([KEY])

/** Every timer and microtask before now has run: a revocation that started has sent its request. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0))

/** The `Cookie` header of session `id` with `refreshToken`, sealed for an hour, and more cookies. */
async function cookieOf(id: string, refreshToken?: string, ...more: string[]): Promise<string> {
  const tokens: SessionTokens = { accessToken: "a", receivedAt: Date.now(), refreshToken }
  const session: WebSession = { id, csrf: "c", name: "n", tokens }
  const sealed = await sealer.seal(SESSION_COOKIE, session, Date.now() + HOUR)
  return [`${SESSION_COOKIE}=${sealed}`, ...more].join("; ")
}

/** The routes' context against the fake, whose revocations go out through a platform it counts. */
function counted(overrides: Parameters<typeof webContext>[1] = {}) {
  const sent: string[] = []
  const platform: Platform = {
    fetch: (input, init) => {
      sent.push(init?.body as string)
      return fetch(input, init)
    },
    now: () => Date.now(),
  }
  return { ...webContext(fake, { platform, ...overrides }), sent }
}

const refuse = async (ctx: Parameters<typeof requestSession>[0], cookie: string) =>
  (await requestSession(ctx, requestTo("/app/api/session", { cookie }))) as Response

describe("requestSession: a session refused as signed out", () => {
  it("revokes the refresh token it holds behind the answer, once per token at this replica", async () => {
    const { ctx, sent } = counted()
    ctx.ended.end("s1", Date.now() + HOUR, Date.now())
    expect((await refuse(ctx, await cookieOf("s1", "r1"))).status).toBe(401)
    expect((await refuse(ctx, await cookieOf("s1", "r1"))).status).toBe(401)
    await vi.waitFor(() => expect(fake.revoked).toEqual(["r1"]))
    await settled()
    expect(sent).toHaveLength(1)
    expect(new URLSearchParams(sent[0]).get("token_type_hint")).toBe("refresh_token")
    // Another token of the session, one a call renewed elsewhere, is this replica's to revoke too.
    expect((await refuse(ctx, await cookieOf("s1", "r2"))).status).toBe(401)
    await vi.waitFor(() => expect(fake.revoked).toEqual(["r1", "r2"]))
  })

  it("revokes it where the browser's ended cookie names the session, at a replica that knew nothing of it", async () => {
    const { ctx } = counted()
    const ended = await endedCookie(sealer, "s1", Date.now() + HOUR)
    const cookie = await cookieOf("s1", "r1", ended.split(";")[0])
    expect(cookie).toContain(`${ENDED_COOKIE}=`)
    const response = await refuse(ctx, cookie)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: "signed_out",
      message: "No session: sign in again.",
    })
    await vi.waitFor(() => expect(fake.revoked).toEqual(["r1"]))
  })

  it("answers without waiting for the revocation", async () => {
    const { ctx, sent } = counted({ metadata: () => new Promise(() => {}) })
    ctx.ended.end("s1", Date.now() + HOUR, Date.now())
    expect((await refuse(ctx, await cookieOf("s1", "r1"))).status).toBe(401)
    await settled()
    expect(sent).toEqual([])
  })

  it("logs a revocation that fails, and answers all the same", async () => {
    const closed = await startFakeOidc()
    await closed.close()
    const found = await webContext(fake).ctx.metadata()
    if (found === undefined) throw new Error("the fake gave no metadata")
    const metadata = { ...found, revocationEndpoint: `${closed.serverUrl}/revoke` }
    const { ctx, logged } = counted({ metadata: () => Promise.resolve(metadata) })
    ctx.ended.end("s1", Date.now() + HOUR, Date.now())
    expect((await refuse(ctx, await cookieOf("s1", "r1"))).status).toBe(401)
    await vi.waitFor(() =>
      expect(logged).toContain(
        "Web session refused: the refresh token was not revoked (no token: unreachable).",
      ),
    )
    expect(logged).toContain("Web session refused: it was signed out.")
  })

  it("logs a read of the provider's metadata that fails, and answers all the same", async () => {
    const broken = () => Promise.reject(new Error("discovery broke"))
    const { ctx, logged, sent } = counted({ metadata: broken })
    ctx.ended.end("s1", Date.now() + HOUR, Date.now())
    expect((await refuse(ctx, await cookieOf("s1", "r1"))).status).toBe(401)
    await vi.waitFor(() =>
      expect(logged).toContain(
        "Web session refused: the refresh token was not revoked (discovery broke).",
      ),
    )
    expect(sent).toEqual([])
  })

  it("revokes nothing for a session that holds, or one without a refresh token", async () => {
    const { ctx, sent } = counted()
    const held = await requestSession(ctx, requestTo("/", { cookie: await cookieOf("s1", "r1") }))
    expect(held).not.toBeInstanceOf(Response)
    ctx.ended.end("s2", Date.now() + HOUR, Date.now())
    expect((await refuse(ctx, await cookieOf("s2"))).status).toBe(401)
    await settled()
    expect(sent).toEqual([])
  })
})

/** The session a browser's cookie holds, opened with the server's own seal. */
async function sessionIn(browser: Browser): Promise<{ session: WebSession; expiresAt: number }> {
  const opened = await sealer.open(SESSION_COOKIE, String(browser.cookies.get(SESSION_COOKIE)))
  if (!opened.ok) throw new Error("the browser holds no session that opens")
  return { session: opened.value as WebSession, expiresAt: opened.expiresAt }
}

/** A browser at `app` with `browser`'s session, its access token expired, so its next read renews. */
async function expiredCopy(browser: Browser, app: McpHttpApp): Promise<Browser> {
  const { session, expiresAt } = await sessionIn(browser)
  const tokens = { ...session.tokens, receivedAt: Date.now() - HOUR, expiresAt: Date.now() - 1 }
  const copy = new Browser(app)
  copy.cookies.set(
    SESSION_COOKIE,
    await sealer.seal(SESSION_COOKIE, { ...session, tokens }, expiresAt),
  )
  return copy
}

describe("two replicas built with the same keys", () => {
  it("a refresh token renewed on the other replica after the sign-out renews no more once the browser comes back", async () => {
    const one = await bootWeb(webEnv(fake))
    const other = await bootWeb(webEnv(fake))
    const browser = new Browser(one)
    await signIn(browser, fake)
    const csrf = String((await sessionOf(browser)).body.csrf)
    const [signedIn] = fake.issued.refresh
    // A read under way on the other replica renews the session's tokens; the sign-out sees none.
    const late = await expiredCopy(browser, other)
    expect((await sessionOf(late)).status).toBe(200)
    const renewed = fake.issued.refresh[1]
    expect((await sessionIn(late)).session.tokens.refreshToken).toBe(renewed)
    expect((await browser.logout(csrf)).status).toBe(200)
    expect(fake.revoked).toEqual([signedIn])
    // The late answer sets the session cookie again in the browser that holds the ended cookie,
    // and someone takes a copy of it.
    browser.cookies.set(SESSION_COOKIE, String(late.cookies.get(SESSION_COOKIE)))
    const copy = await expiredCopy(browser, other)
    // The browser comes back, to either replica: refused, and the renewed token revoked.
    expect((await sessionOf(browser)).status).toBe(401)
    await vi.waitFor(() => expect(fake.revoked).toEqual([signedIn, renewed]))
    // The copy, on the replica that never took the sign-out, renews with it no more.
    expect(await sessionOf(copy)).toEqual({
      status: 401,
      body: { code: "signed_out", message: "No session: sign in again." },
    })
    expect(fake.issued.refresh).toHaveLength(2)
  })
})
