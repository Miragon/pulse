import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server"
import { ResourceTemplate } from "@modelcontextprotocol/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { ModulePlugin } from "./composition.js"
import {
  createComposedServer,
  type ComposedServerOptions,
  type RunningServer,
} from "./composed-server.js"
import { answer, pluginOf, rpc, withPlugins } from "./composed-server.test-support.js"
import { viewPrelude } from "./protocol/view-name.js"
import { buildViewResult } from "./view-results.js"
import {
  appOnly,
  showToolBinding,
  strictToolInput,
  viewResourceUri,
} from "./widget-tool-bindings.js"

/**
 * A module written against the official SDK API, as its docs show it: `registerTool`,
 * `registerPrompt` and ext-apps' `registerAppTool` on the server a plugin gets. The boot records
 * each once and serves it on the wire.
 */

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
    info: { name: "official-api-test", version: "0.0.0" },
    modules: [],
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

describe("createComposedServer: modules on the official SDK API", () => {
  const MAP_URI = viewResourceUri("ext_show_map")

  /** A module written from the MCP Apps docs: `registerAppTool`, a feed, a prompt. */
  const official: ModulePlugin = {
    name: "ext",
    register: (server) => {
      registerAppTool(
        server,
        "ext_show_map",
        {
          title: "Map",
          description: "Shows a map.",
          annotations: { readOnlyHint: true },
          inputSchema: strictToolInput({ city: z.string() }),
          _meta: { ui: { resourceUri: MAP_URI } },
        },
        ({ city }) => ({
          content: [{ type: "text" as const, text: `map of ${city}` }],
          structuredContent: { city },
        }),
      )
      server.registerTool(
        "ext_map_data",
        { annotations: { readOnlyHint: true }, ...appOnly },
        () => ({ content: [{ type: "text" as const, text: "{}" }] }),
      )
      server.registerPrompt(
        "ext_plan_trip",
        { description: "Plans a trip.", argsSchema: z.object({ city: z.string() }) },
        ({ city }) => ({
          messages: [
            { role: "user" as const, content: { type: "text" as const, text: `Plan ${city}.` } },
          ],
        }),
      )
    },
  }

  type WireTool = {
    name: string
    _meta?: Record<string, unknown>
    inputSchema: Record<string, unknown>
  }

  it("serves registerAppTool's tool with its view, as the MCP Apps docs register it", async () => {
    const server = await boot(withPlugins(official))
    const { tools } = (await rpc(server.port, "tools/list")) as { tools: WireTool[] }
    const map = tools.find(({ name }) => name === "ext_show_map")
    expect(map?._meta).toEqual({ ui: { resourceUri: MAP_URI }, "ui/resourceUri": MAP_URI })
    expect(map?.inputSchema).toEqual({
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
      additionalProperties: false,
    })
    const feed = tools.find(({ name }) => name === "ext_map_data")
    expect(feed?._meta).toEqual({ ui: { visibility: ["app"] }, "openai/widgetAccessible": true })

    const { resources } = (await rpc(server.port, "resources/list")) as {
      resources: { uri: string; mimeType?: string; description?: string }[]
    }
    expect(resources).toEqual([
      expect.objectContaining({
        uri: MAP_URI,
        mimeType: "text/html;profile=mcp-app",
        description: "Map",
      }),
    ])
    const { contents } = (await rpc(server.port, "resources/read", { uri: MAP_URI })) as {
      contents: { text: string; _meta: { ui: { prefersBorder?: boolean } } }[]
    }
    expect(contents[0].text).toContain(viewPrelude("ext_show_map").trim())
    expect(contents[0]._meta.ui.prefersBorder).toBe(true)

    const called = (await rpc(server.port, "tools/call", {
      name: "ext_show_map",
      arguments: { city: "Munich" },
    })) as { content: { text: string }[]; structuredContent: unknown; _meta: unknown }
    expect(called.content[0].text).toBe("map of Munich")
    expect(called.structuredContent).toEqual({ city: "Munich" })
    expect(called._meta).toEqual({ ui: { resourceUri: MAP_URI }, "ui/resourceUri": MAP_URI })
  })

  it("serves registerPrompt's prompt", async () => {
    const server = await boot(withPlugins(official))
    const { prompts } = (await rpc(server.port, "prompts/list")) as { prompts: { name: string }[] }
    expect(prompts.map(({ name }) => name)).toEqual(["ext_plan_trip"])
    const got = (await rpc(server.port, "prompts/get", {
      name: "ext_plan_trip",
      arguments: { city: "Munich" },
    })) as { messages: { content: { text: string } }[] }
    expect(got.messages[0].content.text).toBe("Plan Munich.")
  })

  it("refuses an unknown key on a tool registered without input, naming the rule", async () => {
    const server = await boot(withPlugins(pluginOf("plain", "plain_ping")))
    const result = (await rpc(server.port, "tools/call", {
      name: "plain_ping",
      arguments: { extra: 1 },
    })) as { isError?: boolean; content: { text: string }[] }
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown key "extra". This tool takes no arguments.')
  })

  it("fails the boot on a tool whose input lets an unknown key through", async () => {
    const loose: ModulePlugin = {
      name: "loose",
      register: (server) => {
        server.registerTool("loose_list", { inputSchema: z.object({ q: z.string() }) }, answer)
      },
    }
    await expect(createComposedServer(options(withPlugins(loose)))).rejects.toThrow(
      'Tool "loose_list" of "loose" takes input that lets an unknown key through',
    )
  })

  it("fails the boot on a tool that binds a resource the server does not serve", async () => {
    const foreign: ModulePlugin = {
      name: "foreign",
      register: (server) => {
        registerAppTool(
          server,
          "foreign_show",
          { _meta: { ui: { resourceUri: "ui://foreign/app.html" } } },
          () => ({ content: [] }),
        )
      },
    }
    await expect(createComposedServer(options(withPlugins(foreign)))).rejects.toThrow(
      'Tool "foreign_show" of "foreign" binds "ui://foreign/app.html", which this server does not serve',
    )
  })

  it("fails the boot, naming both modules, on a resource URI two modules share", async () => {
    const holding = (name: string): ModulePlugin => ({
      name,
      register: (server) => {
        registerAppResource(server, name, "ui://shared/app.html", {}, () => ({ contents: [] }))
      },
    })
    await expect(
      createComposedServer(options(withPlugins(holding("alpha"), holding("beta")))),
    ).rejects.toThrow(
      'Resource URI "ui://shared/app.html" is registered twice: by "alpha" and again by "beta"',
    )
  })

  // Replayed per request: one module's config would fail every request of every module.
  it("fails the boot on what the SDK refuses at registration, not each request", async () => {
    const invalid: ModulePlugin = {
      name: "invalid",
      register: (server) => {
        const config = { cacheHint: { ttlMs: -1 } }
        server.registerResource("Board", "ui://invalid/board.html", config, () => ({
          contents: [],
        }))
      },
    }
    await expect(createComposedServer(options(withPlugins(invalid)))).rejects.toThrow(
      "Invalid cache hint for resource Board",
    )
  })

  it("fails the boot on a module that claims a URI of the bundle's views", async () => {
    const usurper: ModulePlugin = {
      name: "usurper",
      register: (server) => {
        registerAppResource(server, "Map", MAP_URI, {}, () => ({ contents: [] }))
      },
    }
    await expect(createComposedServer(options(withPlugins(official, usurper)))).rejects.toThrow(
      `Resource "Map" of "usurper" registers ${MAP_URI}, but ui://views/ is the boot's`,
    )
  })
})

describe("createComposedServer: a module with a finished HTML view of its own", () => {
  const BOARD_URI = "ui://acme/board.html"
  const BOARD_HTML = "<!doctype html><html><body><h1>Board</h1></body></html>"
  const CSP = { connectDomains: ["https://api.acme.example"] }
  const BOARD_META = { ui: { csp: CSP, prefersBorder: false } }

  /** As an npm package would ship it: the document ready to serve, the tool bound to it. */
  const acme: ModulePlugin = {
    name: "acme",
    register: (server) => {
      registerAppTool(
        server,
        "acme_show_board",
        {
          title: "Board",
          annotations: { readOnlyHint: true },
          inputSchema: strictToolInput({ team: z.string() }),
          ...showToolBinding("acme_show_board", "Board", { resourceUri: BOARD_URI, csp: CSP }),
        },
        ({ team }) => buildViewResult({ team }, `The board of ${team}.`),
      )
      const listed = { description: "A board.", _meta: BOARD_META }
      registerAppResource(server, "Acme board", BOARD_URI, listed, () => ({
        contents: [
          { uri: BOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: BOARD_HTML, _meta: BOARD_META },
        ],
      }))
      server.registerResource(
        "Acme item",
        new ResourceTemplate("acme://items/{id}", { list: undefined }),
        { mimeType: "text/plain" },
        (uri, { id }) => ({ contents: [{ uri: uri.href, text: `item ${String(id)}` }] }),
      )
    },
  }

  /** A bundle view next to it: the two kinds on one server. */
  const bundled: ModulePlugin = {
    name: "bundled",
    register: (server) => {
      server.registerTool(
        "bundled_show_thing",
        {
          title: "Thing",
          annotations: { readOnlyHint: true },
          ...showToolBinding("bundled_show_thing", "Thing"),
        },
        () => buildViewResult({}, "A thing."),
      )
    },
  }

  const FONT_ORIGIN = "https://mcp.example.com"
  const bootBoth = () => boot({ ...withPlugins(acme, bundled), env: { MCP_URL: FONT_ORIGIN } })

  /** A request as the public origin: `MCP_URL` makes the edge guard refuse any other `Host`. */
  const HEADERS = { host: "mcp.example.com" }

  type WireTool = { name: string; _meta?: Record<string, unknown> }
  type WireResource = { uri: string; name: string; mimeType?: string; _meta?: unknown }

  it("lists the tool with both halves naming the module's resource, and no font origin", async () => {
    const server = await bootBoth()
    const { tools } = (await rpc(server.port, "tools/list", {}, HEADERS)) as { tools: WireTool[] }
    const board = tools.find(({ name }) => name === "acme_show_board")
    expect(board?._meta).toEqual({
      ui: { resourceUri: BOARD_URI },
      "ui/resourceUri": BOARD_URI,
      "openai/outputTemplate": BOARD_URI,
      "openai/toolInvocation/invoking": "Loading Board…",
      "openai/toolInvocation/invoked": "Board ready",
      "openai/widgetAccessible": true,
      "openai/resultCanProduceWidget": true,
      "openai/widgetCSP": { connect_domains: ["https://api.acme.example"] },
    })
    const thing = tools.find(({ name }) => name === "bundled_show_thing")
    expect(thing?._meta?.["openai/widgetCSP"]).toEqual({ resource_domains: [FONT_ORIGIN] })
  })

  it("lists the module's resource next to the bundle's view, each as registered", async () => {
    const server = await bootBoth()
    const { resources } = (await rpc(server.port, "resources/list", {}, HEADERS)) as {
      resources: WireResource[]
    }
    expect(resources.map(({ uri }) => uri)).toEqual([
      viewResourceUri("bundled_show_thing"),
      BOARD_URI,
    ])
    expect(resources[1]).toEqual({
      uri: BOARD_URI,
      name: "Acme board",
      mimeType: RESOURCE_MIME_TYPE,
      description: "A board.",
      _meta: BOARD_META,
    })
    const { resourceTemplates } = (await rpc(
      server.port,
      "resources/templates/list",
      {},
      HEADERS,
    )) as { resourceTemplates: { name: string; uriTemplate: string }[] }
    expect(resourceTemplates).toEqual([
      { name: "Acme item", uriTemplate: "acme://items/{id}", mimeType: "text/plain" },
    ])
  })

  it("reads the module's document as it is, with the CSP it states, and no prelude or font", async () => {
    const server = await bootBoth()
    const read = (uri: string) =>
      rpc(server.port, "resources/read", { uri }, HEADERS) as Promise<{
        contents: { uri: string; mimeType: string; text: string; _meta?: unknown }[]
      }>
    expect((await read(BOARD_URI)).contents).toEqual([
      { uri: BOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: BOARD_HTML, _meta: BOARD_META },
    ])
    // The bundle's view keeps its prelude and the font origin, on the same server.
    const view = (await read(viewResourceUri("bundled_show_thing"))).contents[0]
    expect(view.text).toContain(viewPrelude("bundled_show_thing").trim())
    expect(view._meta).toMatchObject({ ui: { csp: { resourceDomains: [FONT_ORIGIN] } } })
    // A second read: each request replays the record into a fresh server.
    expect((await read("acme://items/7")).contents[0].text).toBe("item 7")
    expect((await read(BOARD_URI)).contents[0].text).toBe(BOARD_HTML)
  })

  it("calls the tool and stamps its result with the module's resource", async () => {
    const server = await bootBoth()
    const called = (await rpc(
      server.port,
      "tools/call",
      { name: "acme_show_board", arguments: { team: "ops" } },
      HEADERS,
    )) as { content: { text: string }[]; structuredContent: unknown; _meta: unknown }
    expect(called.content[0].text).toBe("The board of ops.")
    expect(called.structuredContent).toEqual({ team: "ops" })
    expect(called._meta).toEqual({ ui: { resourceUri: BOARD_URI }, "ui/resourceUri": BOARD_URI })
  })

  it("boots without a bundle when no tool binds a view from it", async () => {
    const server = await boot(withPlugins(acme))
    const { resources } = (await rpc(server.port, "resources/list")) as {
      resources: WireResource[]
    }
    expect(resources.map(({ uri }) => uri)).toEqual([BOARD_URI])
    const warnings = vi.mocked(console.warn).mock.calls.map(([line]) => String(line))
    expect(warnings.filter((line) => line.includes("No widget bundle"))).toEqual([])
  })
})
