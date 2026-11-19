import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import {
  createComposedServer,
  type ComposableModule,
  type McpHttpApp,
} from "@miragon/pulse-widget-shell/server"
import { startFakeOidc, type FakeOidc } from "@miragon/pulse-widget-shell/testing/oidc"
import { PAGE_PATTERNS, PAGES } from "../src/pages.js"
import { buildWeb, type WebBuild } from "./web-build.js"

/**
 * The build's pages.json is the page list of src/pages.ts, and the server's boot takes the build
 * as it is: a server with the web app on serves the page at each of them (behind the sign-in), the
 * signed-out page without a session, and every file of the build's assets/ (each under /app/assets),
 * while the build holds nothing else a browser would ask for.
 */

const ORIGIN = "http://localhost"

/** A module of no tools: the boot needs one, the web app needs none. */
const NO_TOOLS: ComposableModule<object> = {
  name: "none",
  configFromEnv: () => ({}),
  knownEnvVars: [],
  createPlugin: () => ({ name: "none", register: () => undefined }),
}

let build: WebBuild
let fake: FakeOidc
let app: McpHttpApp

beforeAll(async () => {
  build = await buildWeb()
  fake = await startFakeOidc({ audience: `${ORIGIN}/mcp` })
  vi.spyOn(console, "info").mockImplementation(() => undefined)
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  vi.spyOn(console, "log").mockImplementation(() => undefined)
  const composed = await createComposedServer({
    info: { name: "web-test", version: "0.0.0" },
    modules: [NO_TOOLS],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {
      MCP_URL: ORIGIN,
      MCP_OAUTH_KEYCLOAK_SERVER_URL: fake.serverUrl,
      MCP_OAUTH_KEYCLOAK_REALM: fake.realm,
      MCP_WEB_CLIENT_ID: "pulse-web",
      MCP_WEB_CLIENT_SECRET: "pulse-web-secret",
      MCP_WEB_SESSION_KEYS: Buffer.from(new Uint8Array(32).fill(5)).toString("base64url"),
      MCP_WEB_DIR: build.dir,
    },
  })
  app = composed.app
}, 120_000)

afterAll(async () => {
  vi.restoreAllMocks()
  await fake.close()
  build.remove()
})

const get = (target: string) =>
  app.fetch(new Request(new URL(target, ORIGIN), { headers: { host: "localhost" } }))

describe("the build's pages.json", () => {
  it("lists the pages of src/pages.ts, /app first", () => {
    const manifest = JSON.parse(readFileSync(join(build.dir, "pages.json"), "utf8")) as unknown
    expect(manifest).toEqual({ pages: [...PAGE_PATTERNS] })
    expect(PAGE_PATTERNS[0]).toBe(PAGES.app)
  })

  it("is what the server serves the page at, behind the sign-in, the query kept", async () => {
    // A pattern's param takes one segment: a board's id.
    const paths = PAGE_PATTERNS.map((pattern) => pattern.replace(/:[a-z]+/g, "invoices"))
    expect(paths).toContain("/app/boards/invoices")
    for (const page of [...paths, `${PAGES.cockpit}?view=jobs&engine=prod`]) {
      const response = await get(page)
      expect(response.status, page).toBe(302)
      const location = new URL(String(response.headers.get("location")), ORIGIN)
      expect(location.pathname).toBe("/app/auth/login")
      expect(location.searchParams.get("return")).toBe(page)
    }
  })

  it("leaves the signed-out page to the server, which serves the build's page there", async () => {
    expect(PAGE_PATTERNS).not.toContain("/app/signed-out")
    const response = await get("/app/signed-out?reason=expired")
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(readFileSync(join(build.dir, "index.html"), "utf8"))
  })
})

describe("the build's files", () => {
  const files = () => readdirSync(build.dir, { recursive: true, encoding: "utf8" }).sort()

  it("are the page, its pages.json and its assets, nothing a browser could not reach", () => {
    const others = files().filter((file) => !file.startsWith("assets"))
    expect(others).toEqual(["index.html", "pages.json"])
  })

  it("serve each asset under /app/assets, immutable, as the page links it", async () => {
    const page = readFileSync(join(build.dir, "index.html"), "utf8")
    const assets = files().filter((file) => file.startsWith("assets/"))
    expect(assets.length).toBeGreaterThan(0)
    for (const asset of assets) {
      const response = await get(`/app/${asset}`)
      expect(response.status, asset).toBe(200)
      expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
    }
    const linked = [...page.matchAll(/(?:src|href)="([^"]+)"/g)].map(([, url]) => url)
    expect(linked.sort()).toEqual(assets.map((asset) => `/app/${asset}`).sort())
  })
})
