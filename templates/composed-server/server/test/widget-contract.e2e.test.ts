import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { Client, Tool } from "@modelcontextprotocol/client"
import { ENGINE_ADMIN_ONLY_TOOLS, engineModule } from "@miragon/pulse-engine-connector"
import {
  SERVED_FONT_FILES,
  SERVED_FONT_PATH,
  VIEW_RESOURCE_URI_PREFIX,
  viewPrelude,
  viewResourceUri,
} from "@miragon/pulse-widget-shell/server"
import { packageVersion, SERVER_INFO, SERVER_INSTRUCTIONS } from "../src/app.js"
import { MODULES } from "../src/setup.js"
import {
  bootComposition,
  closeComposition,
  isAppOnly,
  isComposed,
  isViewBound,
  uiOf,
  type BootedComposition,
} from "./boot.js"

/** The `_meta` a widget tool must carry; fails naming the tool. */
function toolMeta(tool: Tool): Record<string, unknown> {
  expect(tool._meta, `${tool.name} should carry _meta`).toBeTruthy()
  return tool._meta!
}

/** The `_meta` of a view resource as `resources/read` returns it. */
async function readViewMeta(client: Client, uri: string): Promise<Record<string, unknown>> {
  const { contents } = await client.readResource({ uri })
  return (contents[0] as { _meta?: Record<string, unknown> })._meta ?? {}
}

/** `_meta.ui.csp.resourceDomains` of a view resource as `resources/read` returns it. */
async function readResourceDomains(client: Client, uri: string): Promise<string[]> {
  const csp = ((await readViewMeta(client, uri)).ui as { csp?: { resourceDomains?: string[] } })
    ?.csp
  return csp?.resourceDomains ?? []
}

/**
 * Wire-level widget-contract assertions: what ext-apps hosts (Claude Desktop /
 * claude.ai) actually see on tools/list, resources/list and resources/read.
 * Since mcp-use 2 the MCP Apps half (`_meta.ui.*`, the `ui://views/<tool>.html`
 * resources, the CSP) is emitted natively from each tool's `view`/`visibility`
 * binding (one view PER TOOL instead of 1.x's single shared app resource),
 * while widget-shell's `showToolBinding` stamps the Apps SDK half
 * (`openai/*`). Every check derives from the composition (`MODULES` and the
 * tools it lists), so it covers every module this app composes, yours
 * included, with no tool listed by hand: a `*_show_*` tool without its view
 * binding hangs on the host's loading skeleton; a model-visible `*_data` feed
 * gets rendered by the host instead of feeding the in-widget callTool.
 */
describe("widget wire contract (dual-protocol _meta)", () => {
  let booted: BootedComposition
  let client: Client
  let tools: Tool[]
  let viewTools: Tool[]
  let serverOrigin: string

  beforeAll(async () => {
    booted = await bootComposition()
    ;({ client, tools, origin: serverOrigin } = booted)
    viewTools = tools.filter(isViewBound)
  })

  afterAll(async () => {
    await closeComposition(booted)
    vi.unstubAllEnvs()
  })

  it("reports serverInfo from SERVER_INFO and package.json", () => {
    expect(client.getServerVersion()).toMatchObject({ ...SERVER_INFO, version: packageVersion() })
  })

  // Your preamble first, then each active module's own snippet, joined by the
  // shared boot, so the Miragon modules' routing rules (the engine module's
  // engine precedence, analytics' engine filter) reach the model with no code
  // here. A custom module adds one via `instructions` on its definition.
  it("sends your preamble, then each active module's own instructions", () => {
    const snippets = booted.composed.boot.entries.flatMap((entry) => {
      const module = MODULES.find(({ name }) => name === entry.app)
      const snippet = module?.instructions?.(entry.config)?.trim()
      return snippet ? [snippet] : []
    })
    expect(client.getInstructions()).toBe([SERVER_INSTRUCTIONS, ...snippets].join("\n\n"))
  })

  it("emits the full dual-protocol _meta on every model-visible widget tool", () => {
    const widgetTools = viewTools.filter((tool) => uiOf(tool).visibility === undefined)
    for (const tool of widgetTools) {
      const meta = toolMeta(tool)
      const ui = uiOf(tool)
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
    for (const tool of tools.filter((t) => t.name.includes("_show_"))) {
      const ui = uiOf(tool)
      expect(
        ui.resourceUri,
        `${tool.name}: a show tool binds its own view: spread showToolBinding(name, title)`,
      ).toBe(viewResourceUri(tool.name))
      expect(ui.visibility, `${tool.name}: show tools must stay model-visible`).toBeUndefined()
    }
  })

  it("marks every *_data feed app-only + widget-accessible (name-based; catches a forgotten visibility)", () => {
    for (const tool of tools.filter((t) => t.name.endsWith("_data"))) {
      const meta = toolMeta(tool)
      expect(
        isAppOnly(tool),
        `${tool.name}: *_data feeds must carry visibility ["app"] (spread appOnly): a ` +
          `model-visible feed would be rendered by the host instead of feeding the in-widget callTool`,
      ).toBe(true)
      expect(
        uiOf(tool).resourceUri,
        `${tool.name}: *_data feeds must not carry a resourceUri`,
      ).toBe(undefined)
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
    for (const tool of tools.filter(isAppOnly)) {
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
    for (const tool of viewTools) {
      const resource = resources.find((r) => r.uri === viewResourceUri(tool.name))
      expect(resource, `view resource for ${tool.name} should be listed`).toBeDefined()
      expect(resource!.mimeType, tool.name).toBe("text/html;profile=mcp-app")
    }
  })

  // The Apps SDK half mcp-use derives for each view resource (since 2.8 and 2.10): the view's
  // description (showToolBinding's title) and its default display modes, inline and fullscreen.
  it("reads every view with its Apps SDK description and display modes", async () => {
    for (const tool of viewTools) {
      const meta = await readViewMeta(client, viewResourceUri(tool.name))
      expect(meta["openai/widgetDescription"], tool.name).toEqual(expect.stringMatching(/\S/))
      expect(meta["openai/ui"], tool.name).toEqual({
        availableDisplayModes: ["inline", "fullscreen"],
      })
    }
  })

  // The one bundle serves every view: the document's prelude names the view (= its view tool),
  // before the bundle runs, so the bundle mounts that view and re-runs that tool on a stripped result.
  it("names its view in every view document, before the bundle", async () => {
    for (const tool of viewTools) {
      const { contents } = await client.readResource({ uri: viewResourceUri(tool.name) })
      const text = (contents[0] as { text?: string }).text ?? ""
      expect(text, tool.name).toContain(viewPrelude(tool.name))
    }
  })

  it("returns view html embedding the bundle with the request-resolved csp from resources/read", async () => {
    for (const tool of viewTools) {
      const uri = viewResourceUri(tool.name)
      const { contents } = await client.readResource({ uri })
      const content = contents[0] as {
        uri: string
        mimeType?: string
        text?: string
        _meta?: Record<string, unknown>
      }
      expect(content.uri).toBe(uri)
      expect(content.mimeType, uri).toBe("text/html;profile=mcp-app")
      expect(content.text, uri).toContain("<html")

      const csp = (content._meta?.ui as { csp?: Record<string, string[]> } | undefined)?.csp
      expect(csp, `${uri}: read contents should carry _meta.ui.csp`).toBeTruthy()
      // mcp-use appends the request-resolved server origin itself since 2.x.
      expect(csp!.connectDomains, uri).toContain(serverOrigin)
    }
  })

  it("admits the server's origin for resources on EVERY view, where the view loads Geist from", async () => {
    // Without MCP_URL the origin is the one the host read the view from, the
    // same origin the view resolves its font URLs against.
    const { resources } = await client.listResources()
    const views = resources.filter((r) => r.uri.startsWith(VIEW_RESOURCE_URI_PREFIX))
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

/**
 * Behind its public URL (`MCP_URL`) the server declares that origin itself on
 * every view-bound tool (the shell's, the Miragon modules' and YOUR modules'
 * alike, listed and read, and in the Apps SDK half, `openai/widgetCSP`), so
 * a host admits the font route the views load Geist from.
 */
describe("widget wire contract: the font origin under MCP_URL", () => {
  const PUBLIC_ORIGIN = "https://mcp.acme.test"
  let booted: BootedComposition

  beforeAll(async () => {
    booted = await bootComposition({ MCP_URL: `${PUBLIC_ORIGIN}/mcp` })
  })

  afterAll(async () => {
    await closeComposition(booted)
    vi.unstubAllEnvs()
  })

  it("advertises it in resourceDomains on every view resource and to Apps SDK hosts", async () => {
    const { client, tools } = booted
    const { resources } = await client.listResources()
    const views = resources.filter((r) => r.uri.startsWith(VIEW_RESOURCE_URI_PREFIX))
    for (const view of views) {
      expect(await readResourceDomains(client, view.uri), view.uri).toContain(PUBLIC_ORIGIN)
    }
    const widgetTools = tools.filter((t) => t._meta?.["openai/outputTemplate"] !== undefined)
    for (const tool of widgetTools) {
      expect(tool._meta?.["openai/widgetCSP"], tool.name).toEqual({
        resource_domains: [PUBLIC_ORIGIN],
      })
    }
  })
})

/**
 * The engine module's toolsets fail closed: without an OAuth provider (the
 * neutral env clears every `MCP_USE_OAUTH_*`) no selection that does not NAME
 * `engine:admin` may list an admin-only tool: not unset, not an empty or
 * unknown suffix. Runs while the engine module is in `MODULES`.
 */
describe.runIf(isComposed(engineModule.name))("fail-closed engine toolsets", () => {
  const others = MODULES.filter(({ name }) => name !== engineModule.name)
  const unknownSuffix = ["engine:bogus", ...others.map(({ name }) => `${name}:`)].join(",")

  it.each([undefined, "all", "engine:", unknownSuffix])(
    "MCP_ACTIVE_MODULES=%j lists no admin-only tool",
    async (activeModules) => {
      const booted = await bootComposition({ MCP_ACTIVE_MODULES: activeModules })
      try {
        const names = booted.tools.map((t) => t.name)
        expect(names).toContain("engine_list_process_instances")
        for (const tool of ENGINE_ADMIN_ONLY_TOOLS) {
          expect(names, `${tool} must not be listed`).not.toContain(tool)
        }
      } finally {
        await closeComposition(booted)
        vi.unstubAllEnvs()
      }
    },
  )
})
