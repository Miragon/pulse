import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import type { ComposableModule } from "../composition.js"
import { getMcpRequestInfo, type McpRequestInfo } from "../request-context.js"
import { startFakeOidc, FAKE_OIDC_USERS, type FakeOidc } from "../testing/oidc/index.js"
import { createToolsetVocabulary } from "../toolsets.js"
import { appOnly, forViews, showToolBinding } from "../widget-tool-bindings.js"
import { SESSION_COOKIE } from "./cookies.js"
import {
  bootWeb,
  Browser,
  ORIGIN,
  RESOURCE,
  sessionOf,
  signIn,
  webEnv,
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

/**
 * A module with each kind of tool: a view tool, an app-only feed, a model read a view calls, a
 * model read none does, a write a view could call, and a feed only its admin toolset registers.
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

const refreshes = () =>
  fake.requests.filter(
    (r) => r.endpoint === "token" && r.form.get("grant_type") === "refresh_token",
  )

describe("a page's call through the whole server", () => {
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

describe("a page's session renewed through the provider", () => {
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
    // Both leave with the same cookie, before either answer sets the renewed one.
    const [first, second] = await Promise.all([
      post(browser, csrf, "page_rows_data"),
      post(browser, csrf, "page_rows_data"),
    ])
    expect([first.status, second.status]).toEqual([200, 200])
    expect(refreshes()).toHaveLength(1)
    expect(refreshes()[0].form.get("resource")).toBe(RESOURCE)
    expect(first.headers.getSetCookie()[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=`))
    // The next call brings the rotated refresh token, which renews once more.
    expect((await call(browser, "page_rows_data")).status).toBe(200)
    expect(refreshes()).toHaveLength(2)
    expect(refreshes()[1].form.get("refresh_token")).toBe(fake.issued.refresh[1])
    const bearers = ran.map(({ info }) => info?.authorization)
    expect(bearers).toEqual([
      `Bearer ${fake.issued.access[1]}`,
      `Bearer ${fake.issued.access[1]}`,
      `Bearer ${fake.issued.access[2]}`,
    ])
  })

  it("signs the user out when the provider refuses the refresh token", async () => {
    fake = await startFakeOidc({ audience: RESOURCE, accessTokenSeconds: 5 })
    const browser = new Browser(await boot(webEnv(fake)))
    await signIn(browser, fake)
    fake.refuseRefresh()
    const response = await call(browser, "page_rows_data")
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      code: "signed_out",
      message: "No session: sign in again.",
    })
    expect(browser.cookies.size).toBe(0)
    expect((await sessionOf(browser)).status).toBe(401)
    expect(ran).toEqual([])
  })
})
