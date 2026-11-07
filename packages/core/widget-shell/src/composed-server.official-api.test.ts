import { registerAppTool } from "@modelcontextprotocol/ext-apps/server"
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
import { appOnly, strictToolInput, viewResourceUri } from "./widget-tool-bindings.js"

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
      'Tool "foreign_show" binds "ui://foreign/app.html", which this server does not serve',
    )
  })
})
