import path from "node:path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { ENGINE_ADMIN_ONLY_TOOLS } from "@miragon/pulse-engine-connector"
import {
  SERVED_FONT_FILES,
  SERVED_FONT_PATH,
  VIEW_RESOURCE_URI_PREFIX,
  viewPrelude,
  viewResourceUri,
  type RunningServer,
} from "@miragon/pulse-widget-shell/server"
import { createApp, packageVersion, SERVER_INSTRUCTIONS } from "../src/app.js"
import { stubNeutralEnv } from "./neutral-env.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

/**
 * Boot the REAL composition in-process (`createApp`, exactly what
 * `src/index.ts` runs, with a stand-in widget bundle) and list its tools. The
 * env is neutral (`stubNeutralEnv`): no OAuth, edge override or toolset
 * from the developer's shell, and a dead engine URL: tools register fine;
 * only actual calls would fail.
 */
async function bootAndList(
  activeModules: string | undefined,
  env: Record<string, string> = {},
): Promise<{
  app: RunningServer
  client: Client
  origin: string
  tools: ToolEntry[]
}> {
  stubNeutralEnv({ MCP_ACTIVE_MODULES: activeModules, ...env })

  const composed = await createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
  const app = await composed.listen({ port: 0, host: "127.0.0.1" })
  const origin = `http://127.0.0.1:${app.port}`
  const client = new Client({ name: "widget-contract-test", version: "0.0.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`)))
  return { app, client, origin, tools: (await client.listTools()).tools }
}

type ToolEntry = { name: string; _meta?: Record<string, unknown> }

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
 * (`openai/*`). The name-based checks are the load-bearing part: they cover
 * every module this app composes, including custom ones, without listing tools
 * by hand: a `*_show_*` tool without its view binding hangs on the host's
 * loading skeleton; a model-visible `*_data` feed gets rendered by the host
 * instead of feeding the in-widget callTool.
 */
describe("widget wire contract (dual-protocol _meta)", () => {
  let app: RunningServer
  let client: Client
  let tools: ToolEntry[]
  let serverOrigin: string

  beforeAll(async () => {
    ;({ app, client, origin: serverOrigin, tools } = await bootAndList(undefined))
  })

  afterAll(async () => {
    await client?.close()
    await app?.shutdown()
    vi.unstubAllEnvs()
  })

  it("reports serverInfo from package.json plus the instructions", () => {
    expect(client.getServerVersion()).toMatchObject({
      name: "acme-mcp",
      version: packageVersion(),
      title: "Acme MCP",
    })
    // Your preamble first, then each active module's own snippet, joined by
    // the shared boot, so the Miragon modules' routing rules (the engine module's
    // engine precedence, analytics' engine filter) reach the model with no
    // code here. A custom module adds one via `instructions` on its definition.
    const instructions = client.getInstructions() ?? ""
    expect(instructions.startsWith(`${SERVER_INSTRUCTIONS}\n\n`)).toBe(true)
    expect(instructions).toContain('one engine is configured ("default"); `engine` may be omitted.')
    expect(instructions).toContain("analytics (Prometheus metrics of the engines):")
  })

  it("registers the custom notes module alongside the Miragon modules", () => {
    const names = tools.map((t) => t.name)
    expect(names).toContain("notes_list_notes")
    expect(names).toContain("notes_show_notes")
    expect(names).toContain("notes_list_data")
  })

  it("emits the full dual-protocol _meta on every model-visible widget tool", () => {
    const widgetTools = tools.filter((t) => {
      const meta = t._meta
      if (!meta) return false
      const ui = uiBlock(meta)
      return typeof ui.resourceUri === "string" && ui.visibility === undefined
    })
    // The engine/analytics/notes/shell show_* tools.
    expect(widgetTools.length).toBeGreaterThanOrEqual(3)
    expect(widgetTools.map((t) => t.name)).toContain("notes_show_notes")

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
    // 6 analytics show tools and notes_show_notes; the engine module's one view is engine_open_cockpit.
    expect(showTools.length).toBeGreaterThanOrEqual(7)
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
      // in-widget callTool on tools carrying the key; a feed without it
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
    expect(appOnlyTools.map((t) => t.name)).toContain("notes_list_data")

    for (const tool of appOnlyTools) {
      const meta = toolMeta(tool)
      const label = tool.name
      // A RENDERING key on an app-only feed would make hosts render its
      // result instead of returning it to the in-widget callTool.
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

  // The Apps SDK half mcp-use derives for each view resource (since 2.8 and 2.10): the view's
  // description (showToolBinding's title) and its default display modes, inline and fullscreen.
  it("reads every view with its Apps SDK description and display modes", async () => {
    const showTools = tools.filter((t) => t.name.includes("_show_"))
    expect(showTools.map((t) => t.name)).toContain("notes_show_notes")
    for (const tool of showTools) {
      const { contents } = await client.readResource({ uri: viewResourceUri(tool.name) })
      const meta = (contents[0] as { _meta?: Record<string, unknown> })._meta ?? {}
      expect(meta["openai/widgetDescription"], tool.name).toEqual(expect.stringMatching(/\S/))
      expect(meta["openai/ui"], tool.name).toEqual({
        availableDisplayModes: ["inline", "fullscreen"],
      })
    }
    const { contents } = await client.readResource({ uri: viewResourceUri("notes_show_notes") })
    const notesMeta = (contents[0] as { _meta?: Record<string, unknown> })._meta ?? {}
    expect(notesMeta["openai/widgetDescription"]).toBe("Team Notes")
  })

  // The one bundle serves every view: the document's prelude names the view (= its show tool),
  // before the bundle runs, so the bundle mounts that view and re-runs that tool on a stripped result.
  it("names its view in every view document, before the bundle", async () => {
    const viewTools = tools.filter((t) => typeof uiBlock(t._meta ?? {}).resourceUri === "string")
    expect(viewTools.map((t) => t.name)).toContain("notes_show_notes")
    for (const tool of viewTools) {
      const { contents } = await client.readResource({ uri: viewResourceUri(tool.name) })
      const text = (contents[0] as { text?: string }).text ?? ""
      expect(text, tool.name).toContain(viewPrelude(tool.name))
    }
  })

  it("returns view html embedding the bundle with the request-resolved csp from resources/read", async () => {
    const uri = viewResourceUri("notes_show_notes")
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
    // Without MCP_URL the origin is the one the host read the view from, the
    // same origin the view resolves its font URLs against.
    const { resources } = await client.listResources()
    const views = resources.filter((r) => r.uri.startsWith(VIEW_RESOURCE_URI_PREFIX))
    expect(views.map((v) => v.uri)).toContain(viewResourceUri("notes_show_notes"))
    for (const view of views) {
      expect(await readResourceDomains(client, view.uri), view.uri).toContain(serverOrigin)
    }
  })

  // The installed widget-shell (packed, as a customer gets it) serves the files: its boot only
  // warns when it cannot resolve a font package, so this is where a missing one shows.
  it("serves both Geist files from the installed widget-shell", async () => {
    for (const file of Object.values(SERVED_FONT_FILES)) {
      const font = await fetch(`${serverOrigin}${SERVED_FONT_PATH}/${file}`)
      expect(font.status, file).toBe(200)
      expect(font.headers.get("content-type"), file).toBe("font/woff2")
      await font.arrayBuffer()
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
 * every view-bound tool (the shell's, the Miragon modules' and YOUR modules'
 * alike, listed and read, and in the Apps SDK half, `openai/widgetCSP`), so
 * a host admits the font route the views load Geist from.
 */
describe("widget wire contract: the font origin under MCP_URL", () => {
  const PUBLIC_ORIGIN = "https://mcp.acme.test"
  let app: RunningServer
  let client: Client
  let tools: ToolEntry[]

  beforeAll(async () => {
    ;({ app, client, tools } = await bootAndList(undefined, { MCP_URL: `${PUBLIC_ORIGIN}/mcp` }))
  })

  afterAll(async () => {
    await client?.close()
    await app?.shutdown()
    vi.unstubAllEnvs()
  })

  it("advertises it in resourceDomains on every view resource and to Apps SDK hosts", async () => {
    const { resources } = await client.listResources()
    const views = resources.filter((r) => r.uri.startsWith(VIEW_RESOURCE_URI_PREFIX))
    expect(views.map((v) => v.uri)).toContain(viewResourceUri("notes_show_notes"))
    for (const view of views) {
      expect(await readResourceDomains(client, view.uri), view.uri).toContain(PUBLIC_ORIGIN)
    }
    const widgetTools = tools.filter((t) => t._meta?.["openai/outputTemplate"] !== undefined)
    expect(widgetTools.map((t) => t.name)).toContain("notes_show_notes")
    for (const tool of widgetTools) {
      expect(tool._meta?.["openai/widgetCSP"], tool.name).toEqual({
        resource_domains: [PUBLIC_ORIGIN],
      })
    }
  })
})

/**
 * Toolsets fail closed: without an OAuth provider (the neutral env clears every
 * `MCP_USE_OAUTH_*`) no selection that does not NAME `engine:admin` may list
 * an admin-only tool: not unset, not an empty or unknown suffix.
 */
describe("fail-closed toolsets", () => {
  it.each([undefined, "all", "engine:", "engine:bogus,analytics:,notes"])(
    "MCP_ACTIVE_MODULES=%j lists no admin-only tool",
    async (activeModules) => {
      const { app, client, tools } = await bootAndList(activeModules)
      try {
        const names = tools.map((t) => t.name)
        expect(names).toContain("engine_list_process_instances")
        for (const tool of ENGINE_ADMIN_ONLY_TOOLS) {
          expect(names, `${tool} must not be listed`).not.toContain(tool)
        }
      } finally {
        await client.close()
        await app.shutdown()
        vi.unstubAllEnvs()
      }
    },
  )
})
