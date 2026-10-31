import { mkdtemp, writeFile } from "node:fs/promises"
import http from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MCPServer, registerViews } from "mcp-use"
import { oauthCustomProvider } from "mcp-use/oauth"
import { composeModules, type ComposableModule, type ModulePlugin } from "./composition.js"
import {
  createComposedServer,
  type ComposedServerOptions,
  type RunningServer,
} from "./composed-server.js"
import { createInMemoryProfileStore } from "./profile-store.js"
import { getMcpRequestInfo } from "./request-context.js"
import { createShellPlugin } from "./shell-settings.js"
import { createToolsetVocabulary } from "./toolsets.js"
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

const composition = composeModules<object>({
  label: "plugins-test",
  modules: [alpha],
  appEnvVars: ["MCP_ACTIVE_MODULES"],
})

const shellPlugin = () =>
  createShellPlugin({ profileStore: createInMemoryProfileStore(), allowSave: false })

const pluginOf = (name: string, ...toolNames: string[]): ModulePlugin => ({
  name,
  register: (server) => {
    for (const toolName of toolNames) server.tool({ name: toolName }, answer)
  },
})

const PLUGIN_TOOLS = [
  "alpha_ping",
  "alpha_show_thing",
  "shell_settings_data",
  "shell_show_settings",
]

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
    label: "plugins-test",
    info: { name: "plugins-test", version: "0.0.0" },
    composition,
    bundle: { jsPath: "/nonexistent/mcp-app.js" },
    env: {},
    setup: (boot) => ({ plugins: [shellPlugin(), ...composition.pluginsFor(boot.entries, {})] }),
    ...overrides,
  }
}

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
      options({ oauth: testOAuth(), env: { MCP_ACTIVE_MODULES: "alpha:operations" } }),
    )
    const names = tool.mock.calls.map(([definition]) => definition.name)
    expect(names.sort()).toEqual(PLUGIN_TOOLS)
  })

  it("hands a plugin's tools the ambient request info without the plugin installing it", async () => {
    const probe: ModulePlugin = {
      name: "probe",
      register: (server) => {
        server.tool({ name: "probe_auth" }, () => ({
          content: [{ type: "text" as const, text: getMcpRequestInfo()?.authorization ?? "none" }],
        }))
      },
    }
    const server = await boot({ setup: () => ({ plugins: [probe] }) })
    const result = (await rpc(
      server.port,
      "tools/call",
      { name: "probe_auth", arguments: {} },
      { authorization: "Bearer probe-token" },
    )) as { content: { text: string }[] }
    expect(result.content[0].text).toBe("Bearer probe-token")
  })

  it("fails the boot on a tool name two modules register, naming both", async () => {
    const twice = (...plugins: ModulePlugin[]) =>
      createComposedServer(options({ setup: () => ({ plugins }) }))
    await expect(twice(pluginOf("one", "x_dup"), pluginOf("two", "x_dup"))).rejects.toThrow(
      'Tool "x_dup" is registered twice: by "one" and again by "two".',
    )
    await expect(twice(shellPlugin(), pluginOf("alpha", "shell_show_settings"))).rejects.toThrow(
      'by "shell" and again by "alpha"',
    )
  })

  it("shuts down what setup opened when the boot fails after it", async () => {
    const shutdown = vi.fn(() => Promise.resolve())
    const failing = createComposedServer(
      options({
        setup: () => ({ plugins: [pluginOf("one", "x_dup"), pluginOf("two", "x_dup")], shutdown }),
      }),
    )
    await expect(failing).rejects.toThrow('Tool "x_dup" is registered twice')
    expect(shutdown).toHaveBeenCalledOnce()
  })

  it("keeps the boot error when the shutdown after it fails too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const shutdown = () => Promise.reject(new Error("pool gone"))
    const failing = createComposedServer(
      options({
        setup: () => ({ plugins: [pluginOf("one", "x_dup"), pluginOf("two", "x_dup")], shutdown }),
      }),
    )
    await expect(failing).rejects.toThrow('Tool "x_dup" is registered twice')
    expect(console.error).toHaveBeenCalledWith(
      "[plugins-test] shutdown failed:",
      new Error("pool gone"),
    )
  })

  it("counts a boot as authenticated only when it installs OAuth", async () => {
    const resolveBoot = vi.spyOn(composition, "resolveBoot")
    // An untyped root may hand over `null`; it installs no bearer gate, so it gets no writes.
    const oauth = null as unknown as ComposedServerOptions["oauth"]
    await createComposedServer(options({ oauth }))
    expect(resolveBoot).toHaveBeenCalledWith({}, { authenticated: false })
  })
})

describe("createComposedServer: the views", () => {
  it("primes every bound view once, after the last plugin, with the one bundle", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "composed-bundle-"))
    const bundle = { jsPath: path.join(dir, "app.js"), cssPath: path.join(dir, "app.css") }
    await writeFile(bundle.jsPath, "globalThis.bundleMarker = 41")
    await writeFile(bundle.cssPath, ".bundle-marker { color: inherit }")
    const prime = vi.spyOn(MCPServer.prototype, registerViews)
    const server = await boot({
      bundle,
      setup: (resolved) => ({
        plugins: [
          shellPlugin(),
          ...composition.pluginsFor(resolved.entries, {}),
          pluginOf("late", "late_list"),
        ],
      }),
    })
    expect(prime).toHaveBeenCalledOnce()
    expect(Object.keys(prime.mock.calls[0][0]).sort()).toEqual([
      "alpha_show_thing",
      "shell_show_settings",
    ])
    for (const uri of ["ui://views/alpha_show_thing.html", "ui://views/shell_show_settings.html"]) {
      const { contents } = (await rpc(server.port, "resources/read", { uri })) as {
        contents: { text: string }[]
      }
      expect(contents[0].text, uri).toContain("globalThis.bundleMarker = 41")
      expect(contents[0].text, uri).toContain(".bundle-marker { color: inherit }")
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
    await createComposedServer(options({ setup: () => ({ plugins: [pluginOf("plain", "x")] }) }))
    expect(prime).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("No widget bundle"))
  })
})
