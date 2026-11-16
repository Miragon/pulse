import path from "node:path"
import { brotliDecompressSync } from "node:zlib"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { createComposedServer, type RunningServer } from "../composed-server.js"
import { moduleOf, plain, rawRequest } from "../composed-server.test-support.js"
import { NOT_NORMAL_TARGET } from "../http-edge.js"
import { startFakeOidc, type FakeOidc } from "../testing/oidc/index.js"
import {
  buildWith,
  compressible,
  FIXTURE_BUILD,
  INDEX_HTML,
  removeBuilds,
  STYLESHEET,
  STYLESHEET_CSS,
} from "./build.test-support.js"
import { SESSION_COOKIE } from "./cookies.js"
import { bootWeb, Browser, ORIGIN, RESOURCE, webEnv } from "./sign-in.test-support.js"

let fake: FakeOidc
let info: MockInstance<(...data: unknown[]) => void>
const running: RunningServer[] = []

beforeEach(async () => {
  fake = await startFakeOidc({ audience: RESOURCE })
  info = vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.shutdown()))
  vi.restoreAllMocks()
  removeBuilds()
  await fake.close()
})

const IMMUTABLE = "public, max-age=31536000, immutable"
const COCKPIT = "/app/cockpit?view=process&engine=prod&processDefinitionKey=invoice"

/** Where a redirect to the sign-in returns to, else `undefined`. */
function returnOf(response: Response): string | null | undefined {
  const location = new URL(String(response.headers.get("location")), ORIGIN)
  if (location.pathname !== "/app/auth/login") return undefined
  return location.searchParams.get("return")
}

/** A browser signed in through the page route `target`: the page's redirect, the whole sign-in. */
async function signedInAt(target: string) {
  const browser = new Browser(await bootWeb(webEnv(fake)))
  const page = await browser.fetch(target)
  const login = await browser.fetch(String(page.headers.get("location")))
  const callback = await browser.fetch(await fake.signIn(String(login.headers.get("location"))))
  return { browser, callback }
}

describe("the web build's pages", () => {
  it("send a browser without a session on to the sign-in, the page and its query to return to", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    for (const target of ["/app", COCKPIT, "/app/boards/ops?x=1"]) {
      const response = await browser.fetch(target)
      expect(response.status, target).toBe(302)
      expect(returnOf(response), target).toBe(target)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(response.headers.getSetCookie()).toEqual([])
    }
    expect((await browser.fetch("/app")).headers.get("location")).toBe(
      "/app/auth/login?return=%2Fapp",
    )
  })

  it("return there after the sign-in, the query kept, and show the page", async () => {
    const { browser, callback } = await signedInAt(COCKPIT)
    expect(callback.headers.get("location")).toBe(COCKPIT)
    for (const target of [COCKPIT, "/app", "/app/boards/ops"]) {
      const page = await browser.fetch(target)
      expect(page.status, target).toBe(200)
      expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8")
      expect(page.headers.get("cache-control")).toBe("no-store")
      expect(await page.text()).toBe(INDEX_HTML)
    }
  })

  it("answer only the routes pages.json names", async () => {
    const { browser } = await signedInAt("/app")
    for (const target of ["/app/boards", "/app/boards/ops/x", "/app/nothing", "/app/index.html"]) {
      expect((await browser.fetch(target)).status, target).toBe(404)
    }
  })

  it("send a browser whose session cookie no longer opens to the sign-in, the cookie cleared", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    browser.cookies.set(SESSION_COOKIE, "x")
    const response = await browser.fetch("/app/cockpit")
    expect(returnOf(response)).toBe("/app/cockpit")
    expect(response.headers.getSetCookie()).toContainEqual(
      expect.stringMatching(new RegExp(`^${SESSION_COOKIE}=; Max-Age=0`)),
    )
  })

  it("show the signed-out page without a session", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    for (const target of ["/app/signed-out", "/app/signed-out?reason=expired"]) {
      const response = await browser.fetch(target)
      expect(response.status, target).toBe(200)
      expect(response.headers.get("cache-control")).toBe("no-store")
      expect(await response.text()).toBe(INDEX_HTML)
    }
  })

  it("answer HEAD as GET, without a body", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const page = await browser.fetch("/app/cockpit?x=1", { method: "HEAD" })
    expect([page.status, returnOf(page), await page.text()]).toEqual([302, "/app/cockpit?x=1", ""])
    const signedOut = await browser.fetch("/app/signed-out", { method: "HEAD" })
    expect(signedOut.status).toBe(200)
    expect(signedOut.headers.get("content-length")).toBe(String(Buffer.byteLength(INDEX_HTML)))
    expect(await signedOut.text()).toBe("")
    const asset = await browser.fetch(STYLESHEET, { method: "HEAD" })
    expect([asset.status, asset.headers.get("cache-control"), await asset.text()]).toEqual([
      200,
      IMMUTABLE,
      "",
    ])
  })
})

describe("the web build's assets", () => {
  it("answer without a session, immutable for a year", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const response = await browser.fetch(STYLESHEET)
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8")
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(STYLESHEET_CSS)))
    expect(response.headers.get("cache-control")).toBe(IMMUTABLE)
    expect(response.headers.get("vary")).toBe("Accept-Encoding")
    expect(response.headers.get("etag")).toMatch(/^"[\w-]{43}"$/)
    expect(await response.text()).toBe(STYLESHEET_CSS)
  })

  it("answer 404 for anything else under /app, never stored", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const targets = [
      "/app/assets/missing.css",
      "/app/assets",
      "/app/pages.json",
      "/app/assets/app-3f9a1c.CSS",
    ]
    for (const target of targets) {
      const response = await browser.fetch(target)
      expect(response.status, target).toBe(404)
      expect(response.headers.get("cache-control"), target).toBe("no-store")
    }
  })

  it("know no alias: neither %2e nor another escape of a plain character reaches a file or a page", async () => {
    const browser = new Browser(await bootWeb(webEnv(fake)))
    const targets = [
      "/app/assets/app-3f9a1c%2Ecss",
      "/app/assets/app-3f9a1c%2ecss",
      "/app/assets/%61pp-3f9a1c.css",
      "/app/%61ssets/app-3f9a1c.css",
      "/app/assets%2Fapp-3f9a1c.css",
      "/app/cockpi%74",
      "/%61pp",
    ]
    for (const target of targets) expect((await browser.fetch(target)).status, target).toBe(404)
  })

  it("answer a name that needs escaping at the escape a browser sends, and only there", async () => {
    const { build } = buildWith({ "assets/a b.css": "a", "assets/grüße.css": "b" })
    const browser = new Browser(await bootWeb(webEnv(fake, { MCP_WEB_DIR: build })))
    expect(await (await browser.fetch("/app/assets/a%20b.css")).text()).toBe("a")
    expect(await (await browser.fetch("/app/assets/gr%C3%BC%C3%9Fe.css")).text()).toBe("b")
    for (const target of ["/app/assets/gr%c3%bc%c3%9fe.css", "/app/assets/a+b.css"]) {
      expect((await browser.fetch(target)).status, target).toBe(404)
    }
  })
})

const probe = moduleOf({ name: "probe", register: (server) => plain(server, "probe_tool") })

/** The web app on a real listener, for the targets only the listener sees as sent. */
async function listening(env: NodeJS.ProcessEnv = {}) {
  const composed = await createComposedServer({
    info: { name: "web-test", version: "0.0.0" },
    modules: [probe],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: webEnv(fake, env),
  })
  const server = await composed.listen({ port: 0, host: "127.0.0.1" })
  running.push(server)
  return server.port
}

/** What a URL parser folds onto a route of `/app`, and its shapes with a slash or a backslash. */
function aliasesOf(route: string): string[] {
  const below = route.slice("/app".length)
  return [
    `${route}/`,
    `${route}/.`,
    `${route}/..`,
    `${route}/x/..`,
    `${route}\\`,
    `/./app${below}`,
    `/x/../app${below}`,
    `/%2e/app${below}`,
    `/%2E%2E/app${below}`,
    `//app${below}`,
    `/\\app${below}`,
    ...(below === ""
      ? []
      : [`/app/.${below}`, `/app/%2e${below}`, `/app/${below}`, `/app\\${below.slice(1)}`]),
  ]
}

describe("the listener in front of /app", () => {
  it.each([
    ["/app", 302],
    ["/app/cockpit", 302],
    ["/app/boards/ops", 302],
    ["/app/signed-out", 200],
    [STYLESHEET, 200],
  ])("refuses every alias of %s with 404, which answers its own path", async (route, status) => {
    const port = await listening()
    expect((await rawRequest(port, { target: route })).status).toBe(status)
    for (const target of aliasesOf(route)) {
      const refused = await rawRequest(port, { target })
      expect(refused.status, target).toBe(404)
      expect(JSON.parse(refused.body), target).toEqual({
        jsonrpc: "2.0",
        error: { code: -32000, message: NOT_NORMAL_TARGET },
        id: null,
      })
    }
  })
})

describe("the listener and an encoded asset", () => {
  it("sends it as /app answers it: its encoding, the length of its bytes, the bytes", async () => {
    const script = compressible(4096)
    const { build } = buildWith({ "assets/app.js": script })
    const port = await listening({ MCP_WEB_DIR: build })
    const headers = { "Accept-Encoding": "gzip, deflate, br, zstd" }
    const answer = await rawRequest(port, { target: "/app/assets/app.js", headers })
    const bytes = Buffer.from(answer.body, "latin1")
    expect(answer.status).toBe(200)
    expect(answer.head).toMatch(/^content-encoding: br$/im)
    expect(answer.head).toMatch(new RegExp(`^content-length: ${bytes.byteLength}$`, "im"))
    expect(brotliDecompressSync(bytes).toString("utf8")).toBe(script)
  })
})

describe("the boot and the web build", () => {
  it("serves the build the root names, and the one MCP_WEB_DIR names over it", async () => {
    const env = webEnv(fake)
    delete env.MCP_WEB_DIR
    const root = new Browser(await bootWeb(env, { web: { dir: FIXTURE_BUILD } }))
    expect(await (await root.fetch("/app/signed-out")).text()).toBe(INDEX_HTML)
    const { build } = buildWith({ "index.html": "<!doctype html><title>Other</title>" })
    const missing = path.join(build, "missing")
    const named = new Browser(
      await bootWeb(webEnv(fake, { MCP_WEB_DIR: build }), { web: { dir: missing } }),
    )
    expect(await (await named.fetch("/app/signed-out")).text()).toBe(
      "<!doctype html><title>Other</title>",
    )
  })

  it("fails without the build while MCP_WEB_CLIENT_ID is set, before it logs a line", async () => {
    const missing = path.join(buildWith().folder, "missing")
    await expect(bootWeb(webEnv(fake, { MCP_WEB_DIR: missing }))).rejects.toThrow(
      `MCP_WEB_CLIENT_ID is set, but ${missing} holds no web build (no index.html and no pages.json)`,
    )
    expect(info).not.toHaveBeenCalled()
  })

  it("reads and serves no build without MCP_WEB_CLIENT_ID", async () => {
    const env = webEnv(fake)
    for (const name of ["MCP_WEB_CLIENT_ID", "MCP_WEB_CLIENT_SECRET", "MCP_WEB_SESSION_KEYS"]) {
      delete env[name]
    }
    const missing = path.join(buildWith().folder, "missing")
    const browser = new Browser(await bootWeb(env, { web: { dir: missing } }))
    for (const target of ["/app", "/app/signed-out", STYLESHEET]) {
      expect((await browser.fetch(target)).status, target).toBe(404)
    }
  })
})
