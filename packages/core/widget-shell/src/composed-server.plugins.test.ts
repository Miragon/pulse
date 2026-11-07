import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { McpHttpApp } from "./mcp-server.js"
import { oauthCustomProvider } from "./oauth-providers.js"
import type { ComposableModule, ModulePlugin } from "./composition.js"
import {
  createComposedServer,
  type ComposedServerOptions,
  type RunningServer,
} from "./composed-server.js"
import {
  answer,
  moduleOf,
  plain,
  pluginOf,
  rpc,
  withPlugins,
} from "./composed-server.test-support.js"
import { getMcpRequestInfo } from "./request-context.js"
import { createToolsetVocabulary } from "./toolsets.js"
import { viewPrelude } from "./protocol/view-name.js"
import { showToolBinding } from "./widget-tool-bindings.js"

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
      plain(server, "alpha_ping", { description: "Pings." })
      server.registerTool(
        "alpha_show_thing",
        {
          title: "Thing",
          description: "Shows a thing.",
          ...showToolBinding("alpha_show_thing", "Thing"),
        },
        answer,
      )
    },
  }),
}

/** A plugin outside alpha, owning a plain feed and a view-bound show tool. */
const panelPlugin = (): ModulePlugin => ({
  name: "panel",
  register: (server) => {
    plain(server, "panel_data", { description: "Feeds the panel." })
    server.registerTool(
      "panel_show_panel",
      {
        title: "Panel",
        description: "Shows the panel.",
        ...showToolBinding("panel_show_panel", "Panel"),
      },
      answer,
    )
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

async function boot(overrides: Partial<ComposedServerOptions> = {}) {
  const composed = await createComposedServer(options(overrides))
  const server = await composed.listen({ port: 0, host: "127.0.0.1" })
  running.push(server)
  return server
}

/** A stub IdP; `acceptAny` lets every bearer token through, bound to this server. */
const testOAuth = ({ acceptAny = false } = {}) =>
  oauthCustomProvider({
    resource: "http://localhost/mcp",
    oauthMetadata: {
      issuer: "https://idp.example.test",
      authorization_endpoint: "https://idp.example.test/a",
      token_endpoint: "https://idp.example.test/t",
      response_types_supported: ["code"],
    },
    createTokenVerifier: (resource) => ({
      verifyAccessToken: (token) =>
        acceptAny
          ? Promise.resolve({
              token,
              clientId: "test",
              scopes: [],
              resource,
              expiresAt: Math.floor(Date.now() / 1000) + 3600,
            })
          : Promise.reject(new Error("no tokens in this test")),
    }),
    mapAuthInfo: () => ({ user: {}, payload: {}, permissions: [] }),
  })

describe("createComposedServer: the plugins' tools", () => {
  it("serves the plugins' tools and nothing else", async () => {
    const server = await boot()
    const { tools } = (await rpc(server.port, "tools/list")) as { tools: { name: string }[] }
    expect(tools.map(({ name }) => name).sort()).toEqual(PLUGIN_TOOLS)
  })

  it("serves only the plugins' tools, also under OAuth with every module writable", async () => {
    const server = await boot({
      oauth: testOAuth({ acceptAny: true }),
      env: { MCP_ACTIVE_MODULES: "panel,alpha:operations" },
    })
    const { tools } = (await rpc(
      server.port,
      "tools/list",
      {},
      { authorization: "Bearer any" },
    )) as { tools: { name: string }[] }
    expect(tools.map(({ name }) => name).sort()).toEqual(PLUGIN_TOOLS)
  })

  // A real call through the SDK: the metrics middleware wraps the replayed handler.
  it("hands a plugin's tools the ambient request info and counts the call by tool", async () => {
    const probe: ModulePlugin = {
      name: "probe",
      register: (server) => {
        server.registerTool("probe_auth", {}, () => ({
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

describe("createComposedServer: writes no toolset narrows", () => {
  /** Reads only, without toolsets: nothing to narrow, nothing to warn about. */
  const reader: ModulePlugin = {
    name: "reader",
    register: (server) => {
      server.registerTool("reader_list", { annotations: { readOnlyHint: true } }, answer)
    },
  }

  const openWrites = () =>
    vi
      .mocked(console.warn)
      .mock.calls.map(([line]) => String(line))
      .filter((line) => line.includes("declares no toolsets"))

  const warning = (tool: string, module = "panel") =>
    `[plugins-test] ${tool} is a write and its module "${module}" declares no toolsets: anyone who reaches this port can call it. Declare toolsets on "${module}" that keep its writes out of the read-only floor, or configure an OAuth provider (MCP_OAUTH_*); a tool that only reads states readOnlyHint: true.`

  it("warns once per write of a module without toolsets on a boot without OAuth, and still serves it", async () => {
    const modules = [moduleOf(panelPlugin()), alpha, moduleOf(reader)]
    const server = await boot({ modules })
    // alpha's tools carry no readOnlyHint either: its toolsets narrow them, so it never warns.
    expect(openWrites()).toEqual([warning("panel_data"), warning("panel_show_panel")])
    const { tools } = (await rpc(server.port, "tools/list")) as { tools: { name: string }[] }
    expect(tools.map(({ name }) => name)).toEqual(expect.arrayContaining(["panel_data"]))
  })

  it("warns about nothing under OAuth, where every call needs a signed-in caller", async () => {
    await createComposedServer(options({ oauth: testOAuth() }))
    expect(openWrites()).toEqual([])
  })

  it("warns also when the module's suffix is ignored", async () => {
    await createComposedServer(options({ env: { MCP_ACTIVE_MODULES: "panel:read-only" } }))
    expect(openWrites()).toEqual([warning("panel_data"), warning("panel_show_panel")])
  })

  it("names the module as MCP_ACTIVE_MODULES lists it, not the plugin it builds", async () => {
    const crm: ComposableModule<object> = {
      name: "crm",
      configFromEnv: () => ({}),
      knownEnvVars: [],
      createPlugin: () => ({
        name: "crm-plugin",
        register: (server) => {
          const annotations = { readOnlyHint: false, destructiveHint: true }
          server.registerTool("crm_delete_customer", { annotations }, answer)
        },
      }),
    }
    await createComposedServer(options({ modules: [crm, alpha] }))
    expect(openWrites()).toEqual([warning("crm_delete_customer", "crm")])
  })
})

describe("createComposedServer: the views", () => {
  it("primes every bound view once, after the last plugin, with the one bundle behind its name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "composed-bundle-"))
    const bundle = { jsPath: path.join(dir, "app.js"), cssPath: path.join(dir, "app.css") }
    await writeFile(bundle.jsPath, "globalThis.bundleMarker = 41")
    await writeFile(bundle.cssPath, ".bundle-marker { color: inherit }")
    const prime = vi.spyOn(McpHttpApp.prototype, "primeViews")
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
    const prime = vi.spyOn(McpHttpApp.prototype, "primeViews")
    await createComposedServer(options(withPlugins(pluginOf("plain", "x"))))
    expect(prime).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("No widget bundle"))
  })
})
