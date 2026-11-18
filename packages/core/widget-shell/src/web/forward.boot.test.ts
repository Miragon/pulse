import http from "node:http"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { createComposedServer } from "../composed-server.js"
import type { ComposableModule } from "../composition.js"
import { getMcpRequestInfo, type McpRequestInfo } from "../request-context.js"
import { startFakeOidc, FAKE_OIDC_USERS, type FakeOidc } from "../testing/oidc/index.js"
import { createToolsetVocabulary } from "../toolsets.js"
import { appOnly, forViews, showToolBinding } from "../widget-tool-bindings.js"
import { SESSION_COOKIE } from "./cookies.js"
import { createSealer } from "./seal.js"
import {
  bootWeb,
  Browser,
  HOUR,
  KEY,
  ORIGIN,
  RESOURCE,
  sessionOf,
  signIn,
  webEnv,
  SIGN_IN,
} from "./sign-in.test-support.js"

/**
 * A page's calls through a whole server: the sign-in at the fake identity provider, then each
 * call through the route, in-process through the edge guard and the OAuth gate into `/mcp`, where
 * the boot's record, the toolsets and the caller's identity decide as for any client.
 */

let fake: FakeOidc
let logged: MockInstance<(line: string) => void>

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  logged = vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.close()
})

const answer = (value: object) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
  structuredContent: value,
})

/** Every tool the page module ran, with the request info its call ran under. */
const ran: { tool: string; info: McpRequestInfo | undefined }[] = []

const run = (tool: string) => () => {
  ran.push({ tool, info: getMcpRequestInfo() })
  return answer({ tool })
}

/** Whether `signal` aborts within `ms`. */
const abortsWithin = (signal: AbortSignal, ms: number) =>
  new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve(true)
      },
      { once: true },
    )
  })

/** A promise and what settles it. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

/** The slow feed's last call: that it started, and whether its signal aborted while it ran. */
const slow = { started: deferred<void>(), aborted: deferred<boolean>() }

/**
 * A module with each kind of tool: a view tool, an app-only feed, a model read a view calls, a
 * model read none does, a write a view could call, a feed only its admin toolset registers, and a
 * feed that answers only once its call is cancelled, or after three seconds.
 */
const page: ComposableModule<object> = {
  name: "page",
  configFromEnv: () => ({}),
  knownEnvVars: [],
  toolsets: createToolsetVocabulary("page", ["read-only", "operations", "admin"], "read-only", {
    authenticatedDefault: "operations",
  }),
  createPlugin: (config) => ({
    name: "page",
    register: (server) => {
      const read = { annotations: { readOnlyHint: true } }
      server.registerTool(
        "page_open_view",
        { ...read, ...showToolBinding("page_open_view", "Page") },
        run("page_open_view"),
      )
      server.registerTool("page_rows_data", { ...read, ...appOnly }, run("page_rows_data"))
      server.registerTool("page_list", { ...read, ...forViews }, run("page_list"))
      server.registerTool("page_status", read, run("page_status"))
      server.registerTool(
        "page_retry",
        { annotations: { destructiveHint: false }, ...appOnly },
        run("page_retry"),
      )
      server.registerTool("page_slow_data", { ...read, ...appOnly }, async (ctx) => {
        slow.started.resolve()
        slow.aborted.resolve(await abortsWithin(ctx.mcpReq.signal, 3000))
        return answer({ tool: "page_slow_data" })
      })
      if (config.toolset === "admin") {
        server.registerTool("page_admin_data", { ...read, ...appOnly }, run("page_admin_data"))
      }
    },
  }),
}

beforeEach(() => {
  ran.length = 0
})

const boot = (env: NodeJS.ProcessEnv) => bootWeb(env, { modules: [page] })

/** The CSRF token of the browser's session, which a page reads once. */
const csrfOf = async (browser: Browser) => String((await sessionOf(browser)).body.csrf)

/** A page's call as the browser sends it, with its session's CSRF token. */
function post(browser: Browser, csrf: string, name: string) {
  const headers = {
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "x-pulse-csrf": csrf,
    "content-type": "application/json",
  }
  const body = JSON.stringify({ name, arguments: {} })
  return browser.fetch("/app/api/call", { method: "POST", headers, body })
}

const call = async (browser: Browser, name: string) => post(browser, await csrfOf(browser), name)

/** The CSRF secret of the session {@link holdingExpired} seals. */
const EXPIRED_CSRF = "csrf-of-the-expired-session"

/**
 * A browser at `app` that holds a session of a sign-in at the fake, sealed by hand: its access
 * token expired an hour ago, its refresh token the sign-in's, so its next request renews it.
 */
async function holdingExpired(app: Awaited<ReturnType<typeof boot>>): Promise<Browser> {
  await signIn(new Browser(app), fake)
  const now = Date.now()
  const tokens = {
    accessToken: fake.issued.access[0],
    receivedAt: now - HOUR,
    expiresAt: now - 1,
    refreshToken: fake.issued.refresh[0],
  }
  const session = { id: "expired", csrf: EXPIRED_CSRF, name: "Alice Adams", tokens }
  const browser = new Browser(app)
  const sealed = await createSealer([KEY]).seal(SESSION_COOKIE, session, now + HOUR)
  browser.cookies.set(SESSION_COOKIE, sealed)
  return browser
}

const refreshes = () =>
  fake.requests.filter(
    (r) => r.endpoint === "token" && r.form.get("grant_type") === "refresh_token",
  )

describe("a page's call through the whole server", SIGN_IN, () => {
  it("reaches a view's tools in /mcp as the signed-in user, and no token reaches the page", async () => {
    fake = await startFakeOidc({ audience: RESOURCE })
    const browser = new Browser(await boot(webEnv(fake)))
    await signIn(browser, fake)
    const texts: string[] = []
    for (const name of ["page_open_view", "page_rows_data", "page_list"]) {
      const response = await call(browser, name)
      expect(response.status, name).toBe(200)
      const text = await response.text()
      expect(JSON.parse(text), name).toMatchObject({
        result: { structuredContent: { tool: name } },
      })
      texts.push(text, JSON.stringify([...response.headers]))
    }
    const [access] = fake.issued.access
    expect(ran.map(({ tool, info }) => [tool, info])).toEqual(
      ["page_open_view", "page_rows_data", "page_list"].map((tool) => [
        tool,
        { authUserId: FAKE_OIDC_USERS[0].sub, authorization: `Bearer ${access}` },
      ]),
    )
    for (const token of [...fake.issued.access, ...fake.issued.refresh, ...fake.issued.id]) {
      for (const text of texts) expect(text).not.toContain(token)
    }
  })

  it("refuses a write before its handler runs, a model read no view calls, a tool the toolset left out", async () => {
    fake = await startFakeOidc({ audience: RESOURCE })
    const browser = new Browser(await boot(webEnv(fake)))
    await signIn(browser, fake)
    const refusals = []
    for (const name of ["page_retry", "page_status", "page_admin_data"]) {
      const response = await call(browser, name)
      refusals.push([response.status, ((await response.json()) as { code: string }).code])
    }
    expect(refusals).toEqual([
      [403, "WEB_READ_ONLY"],
      [403, "WEB_NOT_FOR_PAGES"],
      [403, "WEB_NOT_FOR_PAGES"],
    ])
    expect(ran).toEqual([])
  })

  it("names the forward in the request log: the page's route, then its call in /mcp", async () => {
    fake = await startFakeOidc({ audience: RESOURCE })
    const browser = new Browser(await boot(webEnv(fake)))
    await signIn(browser, fake)
    logged.mockClear()
    await call(browser, "page_rows_data")
    const lines = logged.mock.calls.map(([line]) => String(line).replace(/ \d+ms/, " Nms"))
    expect(lines).toContain(
      "tools/call page_rows_data /mcp 200 client=unknown via=/app/api/call Nms",
    )
    expect(lines).toContain("POST /app/api/call 200 Nms")
  })

  it("is served by every replica built with the same keys", async () => {
    fake = await startFakeOidc({ audience: RESOURCE })
    const signedIn = new Browser(await boot(webEnv(fake)))
    await signIn(signedIn, fake)
    const other = new Browser(await boot(webEnv(fake)))
    for (const [name, value] of signedIn.cookies) other.cookies.set(name, value)
    expect((await call(other, "page_rows_data")).status).toBe(200)
  })
})

describe("a page's session renewed through the provider", SIGN_IN, () => {
  it("renews a due token, follows the rotation and shares one refresh among parallel calls", async () => {
    // A token of 5 s is due at once: every call renews it.
    fake = await startFakeOidc({
      audience: RESOURCE,
      accessTokenSeconds: 5,
      rotateRefreshTokens: true,
    })
    const browser = new Browser(await boot(webEnv(fake)))
    await signIn(browser, fake)
    const csrf = await csrfOf(browser)
    // The page's read of its session renewed the due token as a call would.
    expect(refreshes()).toHaveLength(1)
    // Both leave with the same cookie, before either answer sets the renewed one.
    const [first, second] = await Promise.all([
      post(browser, csrf, "page_rows_data"),
      post(browser, csrf, "page_rows_data"),
    ])
    expect([first.status, second.status]).toEqual([200, 200])
    expect(refreshes()).toHaveLength(2)
    expect(refreshes()[1].form.get("resource")).toBe(RESOURCE)
    expect(first.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=`))
    // The next call brings the rotated refresh token, which renews once more.
    expect((await post(browser, csrf, "page_rows_data")).status).toBe(200)
    expect(refreshes()).toHaveLength(3)
    expect(refreshes()[2].form.get("refresh_token")).toBe(fake.issued.refresh[2])
    const bearers = ran.map(({ info }) => info?.authorization)
    expect(bearers).toEqual([
      `Bearer ${fake.issued.access[2]}`,
      `Bearer ${fake.issued.access[2]}`,
      `Bearer ${fake.issued.access[3]}`,
    ])
  })

  it("goes on when a page's parallel calls renew on two replicas and the provider rotates", async () => {
    // The second refresh brings the refresh token the first one spent, which the provider refuses:
    // that replica's first refusal of it, and the token the session holds has not expired, so that
    // call sends it and ends nothing.
    fake = await startFakeOidc({
      audience: RESOURCE,
      accessTokenSeconds: 5,
      rotateRefreshTokens: true,
    })
    const browser = new Browser(await boot(webEnv(fake)))
    await signIn(browser, fake)
    const csrf = await csrfOf(browser)
    const elsewhere = new Browser(await boot(webEnv(fake)))
    for (const [name, value] of browser.cookies) elsewhere.cookies.set(name, value)
    const answers = await Promise.all([
      post(browser, csrf, "page_rows_data"),
      post(elsewhere, csrf, "page_rows_data"),
    ])
    expect(answers.map(({ status }) => status)).toEqual([200, 200])
    // The page's read of its session renewed once, then each replica once.
    expect(refreshes()).toHaveLength(3)
    // One sets the renewed cookie, the other sets none and clears none.
    const setCookies = answers.map((answer) => answer.headers.getSetCookie())
    expect(setCookies.filter((cookies) => cookies.length > 0)).toHaveLength(1)
    expect(setCookies.flat().filter((cookie) => cookie.includes("Max-Age=0"))).toEqual([])
  })

  it("signs the user out once the token expired and the provider refuses the refresh token", async () => {
    fake = await startFakeOidc({ audience: RESOURCE })
    const browser = await holdingExpired(await boot(webEnv(fake)))
    fake.refuseRefresh()
    const response = await post(browser, EXPIRED_CSRF, "page_rows_data")
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: "signed_out",
      message: "No session: sign in again.",
    })
    // A call beside it may have renewed the cookies: they stay, and fail again on their own.
    expect(response.headers.getSetCookie()).toEqual([])
    expect((await post(browser, EXPIRED_CSRF, "page_rows_data")).status).toBe(401)
    // A reload reads no session either, so the page shows that it ended.
    expect(await sessionOf(browser)).toEqual({
      status: 401,
      body: { code: "signed_out", message: "No session: sign in again." },
    })
    // The provider was asked once: the replica keeps its refusal for the requests after it.
    expect(refreshes()).toHaveLength(1)
    expect(ran).toEqual([])
  })

  it("renews an expired token once for a page's read of its session and a call beside it", async () => {
    // With rotation a second refresh of the same refresh token is refused, and the token expired:
    // only the replica's one renewal, which the session route and the calls share, keeps both.
    fake = await startFakeOidc({ audience: RESOURCE, rotateRefreshTokens: true })
    const browser = await holdingExpired(await boot(webEnv(fake)))
    const [session, answer] = await Promise.all([
      sessionOf(browser),
      post(browser, EXPIRED_CSRF, "page_rows_data"),
    ])
    expect([session.status, answer.status]).toEqual([200, 200])
    expect(refreshes()).toHaveLength(1)
    expect(ran.map(({ info }) => info?.authorization)).toEqual([`Bearer ${fake.issued.access[1]}`])
  })
})

describe("a page that leaves while its call runs", SIGN_IN, () => {
  it("cancels the tool's call in /mcp when its connection goes away, and answers it 499", async () => {
    fake = await startFakeOidc({ audience: RESOURCE })
    slow.started = deferred<void>()
    slow.aborted = deferred<boolean>()
    const composed = await createComposedServer({
      info: { name: "web-test", version: "0.0.0" },
      modules: [page],
      bundle: { jsPath: "/nonexistent/mcp-app.js" },
      env: webEnv(fake),
    })
    const running = await composed.listen({ port: 0, host: "127.0.0.1" })
    try {
      const browser = new Browser(composed.app)
      await signIn(browser, fake)
      const body = JSON.stringify({ name: "page_slow_data", arguments: {} })
      const request = http.request({
        host: "127.0.0.1",
        port: running.port,
        method: "POST",
        path: "/app/api/call",
        headers: {
          host: "localhost",
          cookie: browser.cookieHeader,
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "x-pulse-csrf": await csrfOf(browser),
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
        },
      })
      request.on("error", () => {})
      request.end(body)
      await slow.started.promise
      logged.mockClear()
      request.destroy()
      expect(await slow.aborted.promise).toBe(true)
      // The page left: no failure of /mcp, so no 5xx in the request log or the metrics.
      const lines = () => logged.mock.calls.map(([line]) => String(line).replace(/ \d+ms/, " Nms"))
      await vi.waitFor(() => expect(lines()).toContain("POST /app/api/call 499 Nms"))
      expect(lines().filter((line) => / 5\d\d /.test(line))).toEqual([])
    } finally {
      await running.shutdown()
    }
  })
})
