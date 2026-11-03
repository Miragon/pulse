import { mkdtemp, writeFile } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MCPServer, registerViews } from "mcp-use"
import { oauthCustomProvider } from "mcp-use/oauth"
import type { ComposableModule, ModulePlugin } from "./composition.js"
import {
  createComposedServer,
  type ComposedServerOptions,
  type RunningServer,
} from "./composed-server.js"
import { getMcpRequestInfo } from "./request-context.js"
import { createToolsetVocabulary } from "./toolsets.js"
import { viewPrelude } from "./protocol/view-name.js"
import { showToolBinding } from "./widget-tool-bindings.js"

const answer = () => ({ content: [{ type: "text" as const, text: "ok" }], structuredContent: {} })

/** A module the house way: one plain tool and one view-bound show tool. */
const alpha: ComposableModule<object> = {
  name: "alpha",
  configFromEnv: () => ({}),
  knownEnvVars: [],
  toolsets: createToolsetVocabulary("alpha", ["read-only", "operations"] as const, "read-only", {
    authenticatedDefault: "operations",
  }),
  createPlugin: () => ({
    name: "alpha",
    register: (server) => {
      server.tool({ name: "alpha_ping", description: "Pings." }, answer)
      server.tool(
        {
          name: "alpha_show_thing",
          description: "Shows a thing.",
          ...showToolBinding("alpha_show_thing", "Thing"),
        },
        answer,
      )
    },
  }),
}

/** A module without toolsets around one plugin: the boot builds it like any other. */
const moduleOf = (plugin: ModulePlugin): ComposableModule<object> => ({
  name: plugin.name,
  configFromEnv: () => ({}),
  knownEnvVars: [],
  createPlugin: () => plugin,
})

/** A plugin outside alpha, owning a plain feed and a view-bound show tool. */
const panelPlugin = (): ModulePlugin => ({
  name: "panel",
  register: (server) => {
    server.tool({ name: "panel_data", description: "Feeds the panel." }, answer)
    server.tool(
      {
        name: "panel_show_panel",
        description: "Shows the panel.",
        ...showToolBinding("panel_show_panel", "Panel"),
      },
      answer,
    )
  },
})

const pluginOf = (name: string, ...toolNames: string[]): ModulePlugin => ({
  name,
  register: (server) => {
    for (const toolName of toolNames) server.tool({ name: toolName }, answer)
  },
})

const PLUGIN_TOOLS = ["alpha_ping", "alpha_show_thing", "panel_data", "panel_show_panel"]

const running: RunningServer[] = []

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.shutdown()))
  vi.restoreAllMocks()
})

function options(overrides: Partial<ComposedServerOptions> = {}): ComposedServerOptions {
  return {
    info: { name: "plugins-test", version: "0.0.0" },
    modules: [moduleOf(panelPlugin()), alpha],
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    ...overrides,
  }
}

const withPlugins = (...plugins: ModulePlugin[]) => ({ modules: plugins.map(moduleOf) })

async function boot(overrides: Partial<ComposedServerOptions> = {}) {
  const composed = await createComposedServer(options(overrides))
  const server = await composed.listen({ port: 0, host: "127.0.0.1" })
  running.push(server)
  return server
}

/** One JSON-RPC call on a fresh connection; the server is stateless, so no initialize first. */
function rpc(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/mcp",
        agent: false,
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk: Buffer) => chunks.push(chunk))
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8")
          const json = body.trimStart().startsWith("{")
            ? body
            : body
                .split("\n")
                .find((line) => line.startsWith("data: "))!
                .slice("data: ".length)
          resolve((JSON.parse(json) as { result: Record<string, unknown> }).result)
        })
      },
    )
    req.on("error", reject)
    req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }))
  })
}

const testOAuth = () =>
  oauthCustomProvider<unknown>({
    resource: "http://localhost/mcp",
    oauthMetadata: {
      issuer: "https://idp.example.test",
      authorization_endpoint: "https://idp.example.test/a",
      token_endpoint: "https://idp.example.test/t",
      response_types_supported: ["code"],
    },
    createTokenVerifier: () => ({
      verifyAccessToken: () => Promise.reject(new Error("no tokens in this test")),
    }),
    mapAuthInfo: () => ({ user: {}, payload: {}, permissions: [] }),
  })

describe("createComposedServer: the plugins' tools", () => {
  it("serves the plugins' tools and nothing else", async () => {
    const server = await boot()
    const { tools } = (await rpc(server.port, "tools/list")) as { tools: { name: string }[] }
    expect(tools.map(({ name }) => name).sort()).toEqual(PLUGIN_TOOLS)
  })

  it("registers only the plugins' tools, also under OAuth with every module writable", async () => {
    const tool = vi.spyOn(MCPServer.prototype, "tool")
    await createComposedServer(
      options({ oauth: testOAuth(), env: { MCP_ACTIVE_MODULES: "panel,alpha:operations" } }),
    )
    const names = tool.mock.calls.map(([definition]) => definition.name)
    expect(names.sort()).toEqual(PLUGIN_TOOLS)
  })

  // A real call through mcp-use: the metrics middleware hangs on mcp-use's own tools/call event.
  it("hands a plugin's tools the ambient request info and counts the call by tool", async () => {
    const probe: ModulePlugin = {
      name: "probe",
      register: (server) => {
        server.tool({ name: "probe_auth" }, () => ({
          content: [{ type: "text" as const, text: getMcpRequestInfo()?.authorization ?? "none" }],
        }))
      },
    }
    const server = await boot(withPlugins(probe))
    const result = (await rpc(
      server.port,
      "tools/call",
      { name: "probe_auth", arguments: {} },
      { authorization: "Bearer probe-token" },
    )) as { content: { text: string }[] }
    expect(result.content[0].text).toBe("Bearer probe-token")
    const metrics = await fetch(`http://127.0.0.1:${server.port}/metrics`)
    expect(await metrics.text()).toMatch(
      /^mcp_tool_calls_total\{tool="probe_auth",outcome="ok"\} 1$/m,
    )
  })

  it("fails the boot on a tool name two modules register, naming both", async () => {
    const twice = (...plugins: ModulePlugin[]) =>
      createComposedServer(options(withPlugins(...plugins)))
    await expect(twice(pluginOf("one", "x_dup"), pluginOf("two", "x_dup"))).rejects.toThrow(
      'Tool "x_dup" is registered twice: by "one" and again by "two".',
    )
    await expect(twice(panelPlugin(), pluginOf("alpha", "panel_show_panel"))).rejects.toThrow(
      'by "panel" and again by "alpha"',
    )
  })
})

describe("createComposedServer: the views", () => {
  it("primes every bound view once, after the last plugin, with the one bundle behind its name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "composed-bundle-"))
    const bundle = { jsPath: path.join(dir, "app.js"), cssPath: path.join(dir, "app.css") }
    await writeFile(bundle.jsPath, "globalThis.bundleMarker = 41")
    await writeFile(bundle.cssPath, ".bundle-marker { color: inherit }")
    const prime = vi.spyOn(MCPServer.prototype, registerViews)
    const server = await boot({
      bundle,
      modules: [moduleOf(panelPlugin()), alpha, moduleOf(pluginOf("late", "late_list"))],
    })
    expect(prime).toHaveBeenCalledOnce()
    expect(Object.keys(prime.mock.calls[0][0]).sort()).toEqual([
      "alpha_show_thing",
      "panel_show_panel",
    ])
    for (const uri of ["ui://views/alpha_show_thing.html", "ui://views/panel_show_panel.html"]) {
      const { contents } = (await rpc(server.port, "resources/read", { uri })) as {
        contents: { text: string }[]
      }
      const text = contents[0].text
      expect(text, uri).toContain("globalThis.bundleMarker = 41")
      expect(text, uri).toContain(".bundle-marker { color: inherit }")
      // The prelude names THIS view, and runs before the bundle reads it.
      const name = uri.slice("ui://views/".length, -".html".length)
      const prelude = viewPrelude(name).trim()
      expect(text.indexOf(prelude), uri).toBeGreaterThanOrEqual(0)
      expect(text.indexOf(prelude), uri).toBeLessThan(text.indexOf("globalThis.bundleMarker"))
    }
  })

  it("boots without a built bundle, saying the views render empty", async () => {
    await createComposedServer(options())
    expect(console.warn).toHaveBeenCalledWith(
      "[plugins-test] No widget bundle at /nonexistent/mcp-app.js: views render empty until the bundle is built and the server restarts.",
    )
  })

  it("reads no bundle and primes nothing when no tool binds a view", async () => {
    const prime = vi.spyOn(MCPServer.prototype, registerViews)
    await createComposedServer(options(withPlugins(pluginOf("plain", "x"))))
    expect(prime).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("No widget bundle"))
  })
})
