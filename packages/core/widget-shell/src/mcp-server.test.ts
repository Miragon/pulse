import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import type { ModulePlugin } from "./composition.js"
import type { RefusedRequest } from "./http-edge.js"
import { CAPABILITIES, McpHttpApp, type McpHttpAppConfig } from "./mcp-server.js"
import { createModuleRegistry } from "./tool-registration.js"
import { showToolBinding, viewResourceUri } from "./widget-tool-bindings.js"

/** The app on its own, without the boot: one view tool that fails on demand, and a plain tool. */

let log: MockInstance<(line: string) => void>

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

const demo: ModulePlugin = {
  name: "demo",
  register: (server) => {
    server.registerTool(
      "demo_show_x",
      {
        title: "Demo",
        annotations: { readOnlyHint: true },
        ...showToolBinding("demo_show_x", "Demo"),
      },
      () => ({ content: [{ type: "text", text: "{}" }], structuredContent: { shown: true } }),
    )
    server.registerTool("demo_fail", { annotations: { readOnlyHint: true } }, () => ({
      content: [{ type: "text", text: "engine down" }],
      isError: true,
    }))
  },
}

function appOf(overrides: Partial<McpHttpAppConfig> = {}): McpHttpApp {
  const registrations = createModuleRegistry(undefined, "app-test")
  registrations.register(demo)
  return new McpHttpApp({
    name: "app-test",
    version: "0.0.0",
    registrations,
    env: {},
    ...overrides,
  })
}

const post = (app: McpHttpApp, message: object, headers: Record<string, string> = {}) =>
  app.fetch(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-06-18",
        ...headers,
      },
      body: JSON.stringify(message),
    }),
  )

async function call(app: McpHttpApp, method: string, params: Record<string, unknown> = {}) {
  const response = await post(app, { jsonrpc: "2.0", id: 1, method, params })
  const body = await response.text()
  const data = body.trimStart().startsWith("{")
    ? body
    : body
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice("data: ".length)
  return (JSON.parse(data) as { result: Record<string, unknown> }).result
}

describe("McpHttpApp: a path that is not its own normal form", () => {
  it("gets 404, counted and logged like a refusal of the listener", async () => {
    const app = appOf()
    const seen: RefusedRequest[] = []
    app.onRefused((refused) => seen.push(refused))
    const res = await app.fetch(new Request("http://localhost/mcp/"))
    expect(res.status).toBe(404)
    expect(await res.text()).toContain("not in its normal form")
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ method: "GET", target: "/mcp/", status: 404 })
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^GET \/mcp\/ 404 0ms ERROR Not found/)
  })

  it("reports a refusal of the listener to every hook, the log only if the app logs", () => {
    const app = appOf({ log: false })
    const seen: string[] = []
    app
      .onRefused(({ target }) => seen.push(`a ${target}`))
      .onRefused(({ target }) => seen.push(`b ${target}`))
    app.recordRefused({ method: "GET", target: "/./mcp", status: 404, message: "m" })
    expect(seen).toEqual(["a /./mcp", "b /./mcp"])
    expect(log).not.toHaveBeenCalled()
  })
})

describe("McpHttpApp", () => {
  it("serves a view only once its bundle is primed", async () => {
    const app = appOf()
    expect((await call(app, "resources/list")).resources).toEqual([])
    app.primeViews({ demo_show_x: { kind: "inline", js: "", css: "" } })
    const { resources } = (await call(app, "resources/list")) as { resources: { uri: string }[] }
    expect(resources.map(({ uri }) => uri)).toEqual([viewResourceUri("demo_show_x")])
  })

  it("stamps a view tool's result with its view, never an error's", async () => {
    const app = appOf()
    const shown = await call(app, "tools/call", { name: "demo_show_x", arguments: {} })
    expect(shown._meta).toMatchObject({ ui: { resourceUri: viewResourceUri("demo_show_x") } })
    const failed = await call(app, "tools/call", { name: "demo_fail", arguments: {} })
    expect(failed).toMatchObject({ isError: true })
    expect((failed._meta as Record<string, unknown> | undefined)?.ui).toBeUndefined()
  })

  it("announces the capabilities it serves", async () => {
    const result = await call(appOf(), "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "unit", version: "0" },
    })
    expect(result.capabilities).toEqual(CAPABILITIES)
    expect(CAPABILITIES.resources).not.toHaveProperty("subscribe")
  })

  // Honest: no resources/subscribe handler, so no subscribe bit.
  it("answers resources/subscribe as an unknown method", async () => {
    const response = await post(appOf(), {
      jsonrpc: "2.0",
      id: 2,
      method: "resources/subscribe",
      params: { uri: viewResourceUri("demo_show_x") },
    })
    expect(await response.text()).toContain('"code":-32601')
  })

  // One line per request, a failure's text included.
  it("logs a failed MCP request with its error text", async () => {
    const tools = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }
    await post(appOf(), tools, { accept: "application/json" })
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^tools\/list \/mcp 406 client=unknown \d+ms ERROR Not Acceptable: /),
    )
  })

  it("logs nothing with log: false", async () => {
    await call(appOf({ log: false }), "tools/list")
    expect(log).not.toHaveBeenCalled()
  })

  // A root that hands no env gets process.env, the level included.
  it("reads MCP_LOG_LEVEL from process.env without an env of its own", async () => {
    vi.stubEnv("MCP_LOG_LEVEL", "debug")
    await call(appOf({ env: undefined }), "tools/call", {
      name: "demo_show_x",
      arguments: {},
    })
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        expect.stringMatching(
          /^tools\/call demo_show_x \/mcp 200 client=unknown \d+ms \{\} -> \{"shown":true\}$/,
        ),
      ),
    )
  })

  it("closes cleanly before it served anything", async () => {
    await expect(appOf().close()).resolves.toBeUndefined()
  })
})
