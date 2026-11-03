import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { Client } from "@modelcontextprotocol/client"
import {
  VIEW_RESOURCE_URI_PREFIX,
  viewPrelude,
  viewResourceUri,
} from "@miragon/pulse-widget-shell/server"
import { bootServer, type BootedServer } from "./boot-server.js"

type ToolEntry = { name: string; title?: string; _meta?: Record<string, unknown> }

function toolMeta(tool: ToolEntry | undefined): Record<string, unknown> {
  expect(tool?._meta, `${tool?.name ?? "tool"} should carry _meta`).toBeTruthy()
  return tool!._meta!
}

function uiBlock(meta: Record<string, unknown>): Record<string, unknown> {
  return (meta.ui ?? {}) as Record<string, unknown>
}

/**
 * Wire-level widget-contract assertions: what ext-apps hosts (Claude Desktop /
 * claude.ai) actually see on tools/list, resources/list and resources/read.
 * Since mcp-use 2 the MCP Apps half (`_meta.ui.*`, the `ui://views/<tool>.html`
 * resources, the CSP) is emitted natively from each tool's `view`/`visibility`
 * binding (one view PER TOOL instead of 1.x's single shared app resource),
 * while widget-shell's `showToolBinding` stamps the Apps SDK half
 * (`openai/*`). This is the contract whose absence made every widget hang on
 * its loading skeleton.
 */
describe("widget wire contract (dual-protocol _meta)", () => {
  let server: BootedServer
  let client: Client
  let tools: ToolEntry[]
  let serverOrigin: string

  beforeAll(async () => {
    // The widest surface (admin); widget tools and *_data feeds are the
    // same in every toolset.
    server = await bootServer({ env: { MCP_ACTIVE_MODULES: "engine:admin,analytics" } })
    client = server.client
    serverOrigin = `http://127.0.0.1:${server.port}`
    tools = (await client.listTools()).tools
  })

  afterAll(async () => {
    await server?.close()
  })

  it("emits the full dual-protocol _meta on every model-visible widget tool", () => {
    const widgetTools = tools.filter((t) => {
      const meta = t._meta
      if (!meta) return false
      const ui = uiBlock(meta)
      return typeof ui.resourceUri === "string" && ui.visibility === undefined
    })
    // The cockpit plus the engine/analytics show_* tools.
    expect(widgetTools.length).toBeGreaterThanOrEqual(3)
    expect(widgetTools.map((t) => t.name)).toContain("engine_open_cockpit")

    for (const tool of widgetTools) {
      const meta = toolMeta(tool)
      const ui = uiBlock(meta)
      const label = tool.name
      // The view is named after the tool → per-tool view resource uri.
      expect(ui.resourceUri, `${label}: ui.resourceUri`).toBe(viewResourceUri(tool.name))
      expect(meta["openai/outputTemplate"], `${label}: outputTemplate`).toBe(
        viewResourceUri(tool.name),
      )
      expect(meta["openai/widgetAccessible"], `${label}: widgetAccessible`).toBe(true)
      expect(meta["openai/resultCanProduceWidget"], `${label}: resultCanProduceWidget`).toBe(true)
      expect(meta["openai/toolInvocation/invoking"], `${label}: invoking`).toEqual(
        expect.stringMatching(/\S/),
      )
      expect(meta["openai/toolInvocation/invoked"], `${label}: invoked`).toEqual(
        expect.stringMatching(/\S/),
      )
    }
  })

  it("carries widget _meta on every *_show_* tool (name-based; catches a forgotten view binding)", () => {
    // The meta-derived filter above can only check tools that HAVE meta; a
    // show tool that forgot its view binding would silently drop out of it and
    // hang on the host's loading skeleton. The naming convention is the
    // invariant we can enforce unconditionally.
    const showTools = tools.filter((t) => t.name.includes("_show_"))
    // Pinned at the post-cut count: cut 7 removed the twelve engine show tools; the six
    // analytics ones remain (the engine module's one view, engine_open_cockpit, is checked above).
    expect(showTools.length).toBeGreaterThanOrEqual(6)
    for (const tool of showTools) {
      const ui = uiBlock(toolMeta(tool))
      expect(ui.resourceUri, `${tool.name}: show tools must bind their own view`).toBe(
        viewResourceUri(tool.name),
      )
      expect(ui.visibility, `${tool.name}: show tools must stay model-visible`).toBeUndefined()
    }
  })

  it("marks every *_data feed app-only + widget-accessible (name-based; catches a forgotten visibility)", () => {
    const dataTools = tools.filter((t) => t.name.endsWith("_data"))
    expect(dataTools.length).toBeGreaterThanOrEqual(5)
    for (const tool of dataTools) {
      const meta = toolMeta(tool)
      const ui = uiBlock(meta)
      expect(
        Array.isArray(ui.visibility) && (ui.visibility as unknown[]).includes("app"),
        `${tool.name}: *_data feeds must carry visibility ["app"]: a model-visible feed ` +
          `would be rendered by the host instead of feeding the in-widget callTool`,
      ).toBe(true)
      expect(ui.resourceUri, `${tool.name}: *_data feeds must not carry a resourceUri`).toBe(
        undefined,
      )
      // The Apps-SDK half of the dual contract: those hosts only allow
      // in-widget callTool on tools carrying the key. A feed without it
      // renders fine but every pagination/search/refresh is denied.
      expect(
        meta["openai/widgetAccessible"],
        `${tool.name}: *_data feeds must be widget-accessible for Apps-SDK hosts`,
      ).toBe(true)
    }
  })

  it("keeps app-only tools (*_data feeds) free of widget keys", () => {
    const appOnlyTools = tools.filter((t) => {
      const ui = t._meta ? uiBlock(t._meta) : {}
      return Array.isArray(ui.visibility) && (ui.visibility as unknown[]).includes("app")
    })
    expect(appOnlyTools.length).toBeGreaterThanOrEqual(3)
    expect(appOnlyTools.map((t) => t.name)).toContain("engine_widget_actions_data")

    for (const tool of appOnlyTools) {
      const meta = toolMeta(tool)
      const label = tool.name
      // A RENDERING key on an app-only feed would make hosts render its
      // result instead of returning it to the in-widget callTool (invariant 5).
      // `openai/widgetAccessible` is deliberately NOT in this list: it renders
      // nothing; it only authorizes the in-widget callTool on Apps-SDK hosts.
      expect(meta, `${label} must not advertise an output template`).not.toHaveProperty(
        "openai/outputTemplate",
      )
      expect(meta, `${label} must not carry the flat resource uri`).not.toHaveProperty(
        "ui/resourceUri",
      )
    }
  })

  it("lists one view resource per view-bound tool with the mcp-app profile mimeType", async () => {
    const { resources } = await client.listResources()
    const viewResources = resources.filter((r) => r.uri.startsWith(VIEW_RESOURCE_URI_PREFIX))
    const showTools = tools.filter((t) => t.name.includes("_show_"))
    for (const tool of showTools) {
      const resource = viewResources.find((r) => r.uri === viewResourceUri(tool.name))
      expect(resource, `view resource for ${tool.name} should be listed`).toBeDefined()
      expect(resource!.mimeType).toBe("text/html;profile=mcp-app")
    }
  })

  // #344 N159: every module view names itself and asks the host for a border
  // (owner decision 2026-10-12). The cards draw none of their own.
  it("names every module view and asks the host for a border", async () => {
    // Every view-bound tool: the show tools and the cockpit.
    const showTools = tools.filter((t) => typeof uiBlock(t._meta ?? {}).resourceUri === "string")
    // The four view floors in this file are pinned at the post-cut count: cut 7 removed the
    // twelve engine show tools (engine_open_cockpit and six analytics views remain).
    expect(showTools.length).toBeGreaterThanOrEqual(7)
    for (const tool of showTools) {
      const { contents } = await client.readResource({ uri: viewResourceUri(tool.name) })
      const meta = (contents[0] as { _meta?: Record<string, unknown> })._meta ?? {}
      expect(uiBlock(meta).prefersBorder, tool.name).toBe(true)
      // The Apps SDK half mcp-use derives for the view (since 2.8 and 2.10): the view's
      // description and its default display modes, inline and fullscreen (pip is no Apps SDK mode).
      expect(meta["openai/widgetDescription"], tool.name).toBe(tool.title)
      expect(meta["openai/ui"], tool.name).toEqual({
        availableDisplayModes: ["inline", "fullscreen"],
      })
    }
    const { resources } = await client.listResources()
    for (const tool of showTools) {
      const resource = resources.find((r) => r.uri === viewResourceUri(tool.name))
      expect(resource?.description, tool.name).toBe(tool.title)
    }
  })

  // The one bundle serves every view: the document's prelude names the view (= its view tool),
  // before the bundle runs, so the bundle mounts that view and re-runs that tool on a stripped result.
  it("names its view in every view document, before the bundle", async () => {
    const viewTools = tools.filter((t) => typeof uiBlock(t._meta ?? {}).resourceUri === "string")
    expect(viewTools.length).toBeGreaterThanOrEqual(7)
    for (const tool of viewTools) {
      const { contents } = await client.readResource({ uri: viewResourceUri(tool.name) })
      const text = (contents[0] as { text?: string }).text ?? ""
      expect(text, tool.name).toContain(viewPrelude(tool.name))
    }
  })

  it("returns view html embedding the bundle with the request-resolved csp from resources/read", async () => {
    const uri = viewResourceUri("engine_open_cockpit")
    const { contents } = await client.readResource({ uri })
    const content = contents[0] as {
      uri: string
      mimeType?: string
      text?: string
      _meta?: Record<string, unknown>
    }
    expect(content.uri).toBe(uri)
    expect(content.mimeType).toBe("text/html;profile=mcp-app")
    expect(content.text).toContain("<html")

    const csp = uiBlock(content._meta ?? {}).csp as Record<string, string[]> | undefined
    expect(csp, "read contents should carry _meta.ui.csp").toBeTruthy()
    // mcp-use appends the request-resolved server origin itself since 2.x.
    expect(csp!.connectDomains).toContain(serverOrigin)
  })

  it("admits the server's origin for resources on EVERY view, where the view loads Geist from", async () => {
    // Without MCP_URL the origin is the one the host read the view from; the
    // view resolves its font URLs against the same origin (servedFontBaseUrl).
    const { resources } = await client.listResources()
    const views = resources.filter((r) => r.uri.startsWith(VIEW_RESOURCE_URI_PREFIX))
    expect(views.length).toBeGreaterThanOrEqual(7)
    for (const view of views) {
      expect(await readResourceDomains(client, view.uri), view.uri).toContain(serverOrigin)
    }
  })
})

/** `_meta.ui.csp.resourceDomains` of a view resource as `resources/read` returns it. */
async function readResourceDomains(client: Client, uri: string): Promise<string[]> {
  const { contents } = await client.readResource({ uri })
  const csp = uiBlock((contents[0] as { _meta?: Record<string, unknown> })._meta ?? {}).csp as
    { resourceDomains?: string[] } | undefined
  return csp?.resourceDomains ?? []
}

/**
 * Behind its public URL (`MCP_URL`) the server declares that origin itself on
 * every view-bound tool (the cockpit and each module's `*_show_*` alike,
 * listed and read, and in the Apps SDK half, `openai/widgetCSP`), so a host
 * admits the font route (`/fonts/geist-<version>/…`) the views load Geist from.
 */
describe("widget wire contract: the font origin under MCP_URL", () => {
  const PUBLIC_ORIGIN = "https://mcp.example.test"
  let server: BootedServer

  beforeAll(async () => {
    server = await bootServer({
      env: {
        MCP_ACTIVE_MODULES: "engine:admin,analytics",
        MCP_URL: `${PUBLIC_ORIGIN}/mcp`,
      },
    })
  })

  afterAll(async () => {
    await server?.close()
  })

  it("advertises it in resourceDomains on every view resource, listed and read", async () => {
    const { resources } = await server.client.listResources()
    const views = resources.filter((r) => r.uri.startsWith(VIEW_RESOURCE_URI_PREFIX))
    const widgetTools = (await server.client.listTools()).tools.filter(
      (t) => t._meta?.["openai/outputTemplate"] !== undefined,
    )
    // One view per widget tool: the show tools and the cockpit.
    expect(views).toHaveLength(widgetTools.length)
    expect(views.length).toBeGreaterThanOrEqual(7)
    for (const view of views) {
      const listed = uiBlock((view as { _meta?: Record<string, unknown> })._meta ?? {}).csp as
        { resourceDomains?: string[] } | undefined
      expect(listed?.resourceDomains, `${view.uri} listed`).toContain(PUBLIC_ORIGIN)
      expect(await readResourceDomains(server.client, view.uri), `${view.uri} read`).toContain(
        PUBLIC_ORIGIN,
      )
    }
  })

  it("advertises it to Apps SDK hosts on every widget tool (openai/widgetCSP)", async () => {
    const { tools } = await server.client.listTools()
    const widgetTools = tools.filter((t) => t._meta?.["openai/outputTemplate"] !== undefined)
    expect(widgetTools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["engine_open_cockpit", "analytics_show_dashboard"]),
    )
    for (const tool of widgetTools) {
      expect(tool._meta?.["openai/widgetCSP"], tool.name).toEqual({
        resource_domains: [PUBLIC_ORIGIN],
      })
    }
  })
})
