import http from "node:http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AppPlugin } from "@miragon/mcp-toolkit-core"
import type { MCPServer } from "mcp-use"
import { composeModules } from "./composition.js"
import { createComposedServer, type RunningServer } from "./composed-server.js"
import { loadServedFonts } from "./font-assets.js"
import { SERVED_FONT_FILES, SERVED_FONT_PATH } from "./served-fonts.js"
import { createShellPlugin } from "./shell-catalogue.js"
import { showToolBinding } from "./widget-tool-bindings.js"

const composition = composeModules<object>({ label: "fonts-test", modules: [], appEnvVars: [] })
const running: RunningServer[] = []
const SANS = `${SERVED_FONT_PATH}/${SERVED_FONT_FILES.sans}`
const MONO = `${SERVED_FONT_PATH}/${SERVED_FONT_FILES.mono}`

/** A module plugin with one view-bound show tool, registered the house way. */
const showPlugin: AppPlugin<MCPServer> = {
  definition: { name: "demo", steps: [], widgets: [] },
  registerWidgetTools: (server) => {
    server.tool(
      {
        name: "demo_show_thing",
        description: "Shows a thing.",
        ...showToolBinding("demo_show_thing", "Thing"),
      },
      () => ({ content: [{ type: "text" as const, text: "ok" }], structuredContent: {} }),
    )
  },
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.shutdown()))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

async function boot(env: NodeJS.ProcessEnv = {}) {
  // mcp-use reads MCP_URL from process.env itself (the request-resolved origin).
  vi.stubEnv("MCP_URL", env.MCP_URL)
  const composed = await createComposedServer({
    label: "fonts-test",
    info: { name: "fonts-test", version: "0.0.0" },
    composition,
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env,
    setup: () => ({ plugins: [createShellPlugin(), showPlugin] }),
  })
  const server = await composed.listen({ port: 0, host: "127.0.0.1" })
  running.push(server)
  return server
}

interface Raw {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
}

/** Raw HTTP (fetch cannot set `Host`), on a fresh connection. */
function request(
  port: number,
  {
    method = "GET",
    path = "/",
    headers = {},
    body,
  }: {
    method?: string
    path?: string
    headers?: Record<string, string>
    body?: string
  },
): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path, headers, agent: false },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        )
      },
    )
    req.on("error", reject)
    req.end(body)
  })
}

async function rpc(port: number, method: string, params: Record<string, unknown> = {}) {
  const res = await request(port, {
    method: "POST",
    path: "/mcp",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  })
  const text = res.body.toString("utf8")
  const json = text.trimStart().startsWith("{")
    ? text
    : text
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice("data: ".length)
  return (JSON.parse(json) as { result: Record<string, unknown> }).result
}

type Csp = Record<string, string[] | undefined>
type ToolEntry = { name: string; _meta?: Record<string, unknown> }
type ResourceEntry = { uri: string; _meta?: { ui?: { csp?: Csp } } }

const viewResources = async (port: number) =>
  ((await rpc(port, "resources/list")).resources as ResourceEntry[]).filter((r) =>
    r.uri.startsWith("ui://views/"),
  )

async function readCsp(port: number, uri: string): Promise<Csp | undefined> {
  const { contents } = (await rpc(port, "resources/read", { uri })) as {
    contents: ResourceEntry[]
  }
  return contents[0]._meta?.ui?.csp
}

describe("the font route", () => {
  it("serves both files as woff2, cached immutable, readable from the view's sandboxed origin", async () => {
    const server = await boot()
    const files = new Map(loadServedFonts().map(({ file, body }) => [file, body]))
    for (const path of [SANS, MONO]) {
      // A font load from a sandboxed srcdoc view: CORS mode, `Origin: null`.
      const res = await request(server.port, { path, headers: { origin: "null" } })
      expect(res.status, path).toBe(200)
      expect(res.headers).toMatchObject({
        "content-type": "font/woff2",
        "cache-control": "public, max-age=31536000, immutable",
        "access-control-allow-origin": "*",
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
      })
      expect(res.body.equals(Buffer.from(files.get(path.split("/").at(-1)!)!)), path).toBe(true)
    }
  })

  it("answers HEAD without a body and an unknown file with 404", async () => {
    const server = await boot()
    const head = await request(server.port, { method: "HEAD", path: SANS })
    expect(head.status).toBe(200)
    expect(head.headers["content-type"]).toBe("font/woff2")
    expect(head.body.byteLength).toBe(0)
    expect((await request(server.port, { path: `${SERVED_FONT_PATH}/other.woff2` })).status).toBe(
      404,
    )
  })

  it("stays behind the Host guard (DNS rebinding) but passes any Origin on its GET", async () => {
    const server = await boot()
    const foreignHost = await request(server.port, {
      path: SANS,
      headers: { host: "attacker.example" },
    })
    expect(foreignHost.status).toBe(403)
    const hostedView = await request(server.port, {
      path: SANS,
      headers: { origin: "https://abc123.claudemcpcontent.com" },
    })
    expect(hostedView.status).toBe(200)
  })

  it("admits MCP_URL's host — where a hosted view reaches the server", async () => {
    const server = await boot({ MCP_URL: "https://mcp.example.test/mcp" })
    const res = await request(server.port, { path: SANS, headers: { host: "mcp.example.test" } })
    expect(res.status).toBe(200)
  })

  it("is counted in the HTTP metrics under its own route label", async () => {
    const server = await boot()
    await request(server.port, { path: SANS })
    const metrics = (await request(server.port, { path: "/metrics" })).body.toString("utf8")
    expect(metrics).toMatch(
      /^mcp_http_requests_total\{method="GET",route="\/fonts",status="200"\} 1$/m,
    )
  })
})

describe("the font origin on the views", () => {
  it("advertises MCP_URL's origin in resourceDomains on every view resource, listed and read", async () => {
    const server = await boot({ MCP_URL: "https://mcp.example.test/mcp" })
    const resources = await viewResources(server.port)
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "ui://views/demo_show_thing.html",
      "ui://views/render-view.html",
    ])
    for (const resource of resources) {
      expect(resource._meta?.ui?.csp?.resourceDomains, `${resource.uri} listed`).toContain(
        "https://mcp.example.test",
      )
      expect(
        (await readCsp(server.port, resource.uri))?.resourceDomains,
        `${resource.uri} read`,
      ).toContain("https://mcp.example.test")
    }
  })

  it("advertises it to Apps SDK hosts on every widget tool (openai/widgetCSP)", async () => {
    const server = await boot({ MCP_URL: "https://mcp.example.test/mcp" })
    const { tools } = (await rpc(server.port, "tools/list")) as { tools: ToolEntry[] }
    const widgetTools = tools.filter((tool) => tool._meta?.["openai/outputTemplate"] !== undefined)
    expect(widgetTools.map((tool) => tool.name).sort()).toEqual(["demo_show_thing", "render-view"])
    for (const tool of widgetTools) {
      expect(tool._meta?.["openai/widgetCSP"], tool.name).toEqual({
        resource_domains: ["https://mcp.example.test"],
      })
    }
  })

  it("without MCP_URL leaves it to the request: every view admits the origin it was read from", async () => {
    const server = await boot()
    const origin = `http://127.0.0.1:${server.port}`
    for (const resource of await viewResources(server.port)) {
      // mcp-use appends the request-resolved origin, listed and read alike.
      expect(resource._meta?.ui?.csp?.resourceDomains, resource.uri).toEqual([origin])
      expect((await readCsp(server.port, resource.uri))?.resourceDomains, resource.uri).toEqual([
        origin,
      ])
    }
    const { tools } = (await rpc(server.port, "tools/list")) as { tools: ToolEntry[] }
    expect(tools.some((tool) => tool._meta?.["openai/widgetCSP"] !== undefined)).toBe(false)
  })
})
