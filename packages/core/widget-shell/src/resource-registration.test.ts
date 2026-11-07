import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server"
import { ResourceTemplate, type RegisteredResource } from "@modelcontextprotocol/server"
import { describe, expect, it } from "vitest"
import type { ModulePlugin } from "./composition.js"
import type { ModuleServer } from "./module-server.js"
import { createModuleRegistry, type RecordedTool } from "./tool-registration.js"
import { showToolBinding, strictToolInput } from "./widget-tool-bindings.js"

const LABEL = "test-root"
const BOARD_URI = "ui://acme/board.html"
const FONT_CSP = { resourceDomains: ["https://mcp.example.com"] }
const read = () => ({ contents: [] })
const answer = () => ({ content: [], structuredContent: {} })

const moduleOf = (name: string, register: ModulePlugin["register"]): ModulePlugin => ({
  name,
  register,
})

/** A module with one resource of `name` at `uri`. */
const holding = (owner: string, name: string, uri: string) =>
  moduleOf(owner, (server) => {
    server.registerResource(name, uri, {}, read)
  })

const templated = (owner: string, name: string, uriTemplate: string) =>
  moduleOf(owner, (server) => {
    server.registerResource(name, new ResourceTemplate(uriTemplate, { list: undefined }), {}, read)
  })

const showing = (owner: string, tool: string, title = "Thing") =>
  moduleOf(owner, (server) => {
    server.registerTool(tool, { title, ...showToolBinding(tool, title) }, answer)
  })

const bindingOwn = (owner: string, tool: string, resourceUri: string) =>
  moduleOf(owner, (server) => {
    server.registerTool(tool, showToolBinding(tool, "Own", { resourceUri }), answer)
  })

const registryOf = (...plugins: ModulePlugin[]) => {
  const registry = createModuleRegistry(undefined, LABEL)
  for (const plugin of plugins) registry.register(plugin)
  return registry
}

const recorded = (registry: { tools: readonly RecordedTool[] }, name: string): RecordedTool => {
  const tool = registry.tools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`${name} was not recorded`)
  return tool
}

describe("createModuleRegistry: a module's resources", () => {
  it("records ext-apps' registerAppResource on the module server, without a cast", () => {
    const registry = registryOf(
      moduleOf("acme", (server: ModuleServer) => {
        registerAppResource(server, "Board", BOARD_URI, { description: "A board." }, () => ({
          contents: [{ uri: BOARD_URI, mimeType: RESOURCE_MIME_TYPE, text: "<!doctype html>" }],
        }))
      }),
    )
    expect(registry.resources).toEqual([
      {
        name: "Board",
        owner: "acme",
        uri: BOARD_URI,
        config: { mimeType: RESOURCE_MIME_TYPE, description: "A board." },
        callback: expect.any(Function) as unknown,
      },
    ])
    expect(registry.views.size).toBe(0)
  })

  it("records a template under its URI template, with its callback as the SDK calls it", () => {
    const template = new ResourceTemplate("ui://acme/{id}.html", { list: undefined })
    const registry = registryOf(
      moduleOf("acme", (server) => {
        server.registerResource("Item", template, {}, read)
      }),
    )
    expect(registry.resources[0]).toMatchObject({ uri: "ui://acme/{id}.html" })
    expect(registry.resources[0].template?.uriTemplate).toBe(template.uriTemplate)
  })

  it("refuses a URI two registrations share, naming both modules", () => {
    const registry = registryOf(holding("alpha", "Board", BOARD_URI))
    expect(() => registry.register(holding("beta", "Other", BOARD_URI))).toThrow(
      `Resource URI "${BOARD_URI}" is registered twice: by "alpha" and again by "beta". A server serves one resource per URI, so change one of them.`,
    )
    expect(() => registry.register(templated("gamma", "Item", "ui://acme/{id}.html"))).not.toThrow()
    expect(() => registry.register(templated("delta", "Other2", "ui://acme/{id}.html"))).toThrow(
      'Resource URI "ui://acme/{id}.html" is registered twice: by "gamma" and again by "delta".',
    )
  })

  it("refuses a name two registrations share, resource or template, naming both modules", () => {
    const twice = 'Resource "Board" is registered twice: by "alpha" and again by "beta". '
    const rule = "A server lists one resource per name, so rename one of them."
    const registry = registryOf(holding("alpha", "Board", BOARD_URI))
    expect(() => registry.register(holding("beta", "Board", "ui://beta/b.html"))).toThrow(
      twice + rule,
    )
    expect(() => registry.register(templated("beta", "Board", "ui://beta/{id}.html"))).toThrow(
      twice + rule,
    )
  })

  it("refuses a name a bundle view carries, whichever comes first", () => {
    const view = showing("alpha", "x_show_a")
    const resource = holding("beta", "x_show_a", BOARD_URI)
    expect(() => registryOf(view, resource)).toThrow(
      'Resource "x_show_a" is registered twice: by "alpha" and again by "beta".',
    )
    expect(() => registryOf(resource, view)).toThrow(
      'Resource "x_show_a" is registered twice: by "beta" and again by "alpha".',
    )
  })

  // Reserved as a whole, not only what a tool binds so far: the bound tool may register later.
  it("refuses any URI or template under ui://views/, naming the module", () => {
    const refusal = (uri: string) =>
      `Resource "Mine" of "acme" registers ${uri}, but ui://views/ is the boot's: it serves those views from the bundle, and no module may replace one. Use a URI of your own, like ui://acme/<view>.html.`
    expect(() => registryOf(holding("acme", "Mine", "ui://views/x_show_a.html"))).toThrow(
      refusal("ui://views/x_show_a.html"),
    )
    expect(() => registryOf(holding("acme", "Mine", "ui://views/free.html"))).toThrow(
      refusal("ui://views/free.html"),
    )
    expect(() => registryOf(templated("acme", "Mine", "ui://views/{view}.html"))).toThrow(
      refusal("ui://views/{view}.html"),
    )
  })

  it("refuses a URI no read would find, which also could slip past the reserved prefix", () => {
    for (const [uri, normal] of [
      ["ui://views/a/../x_show_a.html", "ui://views/x_show_a.html"],
      ["UI://views/x_show_a.html", "ui://views/x_show_a.html"],
      ["ui://acme/my board.html", "ui://acme/my%20board.html"],
    ]) {
      expect(() => registryOf(holding("acme", "Mine", uri))).toThrow(
        `Resource "Mine" of "acme" registers ${JSON.stringify(uri)}, which no read would find: a read looks it up as ${JSON.stringify(normal)}.`,
      )
    }
    expect(() => registryOf(holding("acme", "Mine", "board"))).toThrow(
      'Resource "Mine" of "acme" registers "board", which no read would find: that is no URI. Name a URI of your own, like ui://acme/<view>.html.',
    )
  })

  it("refuses what is neither URI nor template, and a read callback that is none", () => {
    const loose = (target: unknown, callback: unknown) =>
      moduleOf("acme", (server) => {
        ;(server.registerResource as unknown as (...args: unknown[]) => unknown)(
          "Mine",
          target,
          {},
          callback,
        )
      })
    for (const target of [undefined, 7, new URL(BOARD_URI), {}]) {
      expect(() => registryOf(loose(target, read))).toThrow(
        'Resource "Mine" of "acme" takes neither a URI string nor a ResourceTemplate.',
      )
    }
    expect(() => registryOf(loose(BOARD_URI, undefined))).toThrow(
      'Resource "Mine" of "acme" has no read callback.',
    )
  })

  it("claims no name or URI for a registration it refuses", () => {
    const registry = registryOf()
    expect(() =>
      registry.register(
        moduleOf("alpha", (server) => {
          ;(server.registerResource as unknown as (...args: unknown[]) => unknown)(
            "Board",
            BOARD_URI,
            {},
          )
        }),
      ),
    ).toThrow("has no read callback")
    registry.register(holding("beta", "Board", BOARD_URI))
    expect(registry.resources.map(({ owner }) => owner)).toEqual(["beta"])
  })

  it("refuses a registration after the plugin's register returned", () => {
    let kept: ModuleServer | undefined
    registryOf(moduleOf("late", (server) => void (kept = server)))
    expect(() => kept!.registerResource("Board", BOARD_URI, {}, read)).toThrow(
      'Resource "Board" registers after "late" returned from register(server)',
    )
  })

  it("hands back a handle that refuses to change what the boot replays", () => {
    let handle: RegisteredResource | undefined
    registryOf(
      moduleOf("alpha", (server) => {
        handle = server.registerResource("Board", BOARD_URI, { description: "A board." }, read)
      }),
    )
    expect(handle?.enabled).toBe(true)
    expect(handle?.metadata).toEqual({ description: "A board." })
    for (const change of [
      () => handle!.disable(),
      () => handle!.enable(),
      () => handle!.remove(),
      () => handle!.update({ enabled: false }),
    ]) {
      expect(change).toThrow('Resource "Board" is fixed at boot')
    }
  })
})

describe("createModuleRegistry: a tool bound to a module's resource", () => {
  it("takes the tool before the resource, as ext-apps' docs register them, and in another module", () => {
    const tool = bindingOwn("acme", "acme_show_board", BOARD_URI)
    const resource = holding("acme", "Board", BOARD_URI)
    registryOf(tool, resource).checkBindings()
    registryOf(resource, tool).checkBindings()
    registryOf(tool, holding("other", "Board", BOARD_URI)).checkBindings()
  })

  it("takes a URI a template matches, and refuses one it does not", () => {
    const template = templated("acme", "Item", "ui://acme/{id}.html")
    registryOf(bindingOwn("acme", "acme_show_item", "ui://acme/7.html"), template).checkBindings()
    const unmatched = registryOf(bindingOwn("acme", "acme_show_x", "ui://acme/7/8.html"), template)
    expect(() => unmatched.checkBindings()).toThrow(
      'Tool "acme_show_x" of "acme" binds "ui://acme/7/8.html", which this server does not serve',
    )
  })

  it("refuses a resource no module registers, naming the tool's module and both ways out", () => {
    const registry = registryOf(
      bindingOwn("acme", "acme_show_board", BOARD_URI),
      holding("other", "Elsewhere", "ui://other/x.html"),
    )
    expect(() => registry.checkBindings()).toThrow(
      `Tool "acme_show_board" of "acme" binds "${BOARD_URI}", which this server does not serve: bind the view named after the tool, ui://views/<tool>.html, which the boot serves from the bundle (showToolBinding(name, title)), or a resource a module registers (registerAppResource, showToolBinding(name, title, { resourceUri })).`,
    )
  })

  it("asks nothing of a bundle view: the boot serves it", () => {
    registryOf(showing("alpha", "x_show_a")).checkBindings()
  })

  it("serves no bundle view for it and leaves the server-wide CSP out of it", () => {
    const registry = createModuleRegistry(FONT_CSP, LABEL)
    const csp = { connectDomains: ["https://api.acme.example"] }
    registry.register(
      moduleOf("acme", (server) => {
        server.registerTool(
          "acme_show_board",
          showToolBinding("acme_show_board", "Board", { resourceUri: BOARD_URI, csp }),
          answer,
        )
        server.registerResource("Board", BOARD_URI, { _meta: { ui: { csp } } }, read)
        server.registerTool(
          "acme_show_bare",
          showToolBinding("acme_show_bare", "Bare", {
            resourceUri: BOARD_URI,
          }),
          answer,
        )
      }),
    )
    registry.checkBindings()
    expect(registry.views.size).toBe(0)
    const tool = recorded(registry, "acme_show_board")
    expect(tool.view).toBeUndefined()
    expect(tool.resourceUri).toBe(BOARD_URI)
    expect(tool.config._meta).toMatchObject({
      ui: { resourceUri: BOARD_URI },
      "ui/resourceUri": BOARD_URI,
      "openai/outputTemplate": BOARD_URI,
      "openai/widgetCSP": { connect_domains: ["https://api.acme.example"] },
    })
    expect(recorded(registry, "acme_show_bare").config._meta).not.toHaveProperty("openai/widgetCSP")
    expect(registry.resources[0].config._meta).toEqual({ ui: { csp } })
  })

  it("takes ext-apps' registerAppTool, with only its ui half and with the binding's both", () => {
    const registry = registryOf(
      moduleOf("acme", (server) => {
        registerAppTool(
          server,
          "acme_show_plain",
          { inputSchema: strictToolInput({}), _meta: { ui: { resourceUri: BOARD_URI } } },
          answer,
        )
        registerAppTool(
          server,
          "acme_show_full",
          {
            inputSchema: strictToolInput({}),
            ...showToolBinding("acme_show_full", "Full", { resourceUri: BOARD_URI }),
          },
          answer,
        )
        registerAppResource(server, "Board", BOARD_URI, {}, read)
      }),
    )
    registry.checkBindings()
    expect(recorded(registry, "acme_show_plain").config._meta).toEqual({
      ui: { resourceUri: BOARD_URI },
      "ui/resourceUri": BOARD_URI,
    })
    expect(recorded(registry, "acme_show_full").config._meta).toMatchObject({
      ui: { resourceUri: BOARD_URI },
      "ui/resourceUri": BOARD_URI,
      "openai/outputTemplate": BOARD_URI,
    })
  })

  // A binding spread first and a URI written over it: one view on one host, another on the next.
  it("refuses an Apps SDK template that names another resource than the ui half", () => {
    const registry = createModuleRegistry(undefined, LABEL)
    expect(() =>
      registry.register(
        moduleOf("acme", (server) => {
          const binding = showToolBinding("acme_show_board", "Board")
          const _meta = { ...binding._meta, ui: { resourceUri: BOARD_URI } }
          server.registerTool("acme_show_board", { ...binding, _meta }, answer)
        }),
      ),
    ).toThrow(
      `Tool "acme_show_board" of "acme" binds ${BOARD_URI}, but its openai/outputTemplate names "ui://views/acme_show_board.html": state both with showToolBinding(name, title, { resourceUri }).`,
    )
  })

  it("reads an Apps SDK template alone as the binding, so it is held to the same rules", () => {
    const registry = createModuleRegistry(undefined, LABEL)
    registry.register(
      moduleOf("acme", (server) => {
        server.registerTool(
          "acme_show_board",
          { _meta: { "openai/outputTemplate": BOARD_URI } },
          answer,
        )
      }),
    )
    expect(() => registry.checkBindings()).toThrow(`binds "${BOARD_URI}"`)
    expect(recorded(registry, "acme_show_board").config._meta).toEqual({
      "openai/outputTemplate": BOARD_URI,
      ui: { resourceUri: BOARD_URI },
      "ui/resourceUri": BOARD_URI,
    })
  })
})

describe("createModuleRegistry: a template that could answer under ui://views/", () => {
  it.each([
    "ui://{+rest}",
    "ui://view{a}/{view}.html",
    "ui://{host}/{view}.html",
    "ui://{host}/board.html",
    "ui://views{/view}",
    "ui://views{/view*}",
    "ui:{+rest}",
    "{+all}",
    "{scheme}://views/{view}.html",
    "UI://acme/{view}.html",
  ])("refuses %s, whatever it matches of a bundle view today", (uriTemplate) => {
    expect(() => registryOf(templated("acme", "Mine", uriTemplate))).toThrow(
      `Resource "Mine" of "acme" registers the template ${JSON.stringify(uriTemplate)}, which could answer under ui://views/, the boot's. Spell out its scheme in lower case, and the host of a ui: template, like ui://acme/{view}.html.`,
    )
  })

  it("refuses one no read would find, like a URI out of its normal form", () => {
    expect(() => registryOf(templated("acme", "Mine", "ui://acme/a/../{id}.html"))).toThrow(
      'Resource "Mine" of "acme" registers "ui://acme/a/../{id}.html", which no read would find: a read looks it up as "ui://acme/x.html".',
    )
  })

  it.each([
    "ui://acme/{id}.html",
    "ui://acme/{+rest}",
    "ui://VIEWS/{id}.html",
    "acme://items/{id}",
    "users://{userId}/profile",
    "greeting://{name}",
    "file:///{+path}",
    "urn:acme:{id}",
  ])("takes %s, which stays in its own space", (uriTemplate) => {
    expect(() => registryOf(templated("acme", "Mine", uriTemplate))).not.toThrow()
  })
})

describe("createModuleRegistry: a binding no host would render", () => {
  const binding = (_meta: Record<string, unknown>) =>
    moduleOf("acme", (server) => {
      server.registerTool("acme_show_x", { _meta }, answer)
    })
  const rule = (stated: unknown) =>
    `Tool "acme_show_x" of "acme" binds ${JSON.stringify(stated)}, which no host would render: a view's URI starts with ui:// and names one document, no template.`

  it.each(["https://evil.example/x.html", "file:///x.html", "data:text/html,x", "x.html"])(
    "refuses %s, which ext-apps refuses as a UI resource, with the resource registered",
    (uri) => {
      const served = holding("acme", "X", uri === "x.html" ? BOARD_URI : uri)
      expect(() => registryOf(served, binding({ ui: { resourceUri: uri } }))).toThrow(rule(uri))
      expect(() => registryOf(served, binding({ "ui/resourceUri": uri }))).toThrow(rule(uri))
      expect(() => registryOf(served, binding({ "openai/outputTemplate": uri }))).toThrow(rule(uri))
    },
  )

  it("refuses a template's text: a read would look up its variable as a value", () => {
    const uri = "ui://acme/{id}.html"
    const template = templated("acme", "Item", uri)
    expect(() => registryOf(template, binding({ ui: { resourceUri: uri } }))).toThrow(rule(uri))
  })

  it.each([null, 7, {}])("refuses %j as a URI, which would slip past as unbound", (uri) => {
    expect(() => registryOf(binding({ ui: { resourceUri: uri } }))).toThrow(rule(uri))
    expect(() => registryOf(binding({ "ui/resourceUri": uri }))).toThrow(rule(uri))
  })

  it.each(["ui://acme/board.html", 7, [], null])("refuses %j as _meta.ui, no object", (ui) => {
    expect(() => registryOf(binding({ ui }))).toThrow(
      `Tool "acme_show_x" of "acme" states _meta.ui as ${JSON.stringify(ui)}, which is no object: spread showToolBinding(name, title) instead of writing it.`,
    )
  })

  it("still reads a feed's ui part as no binding", () => {
    const registry = registryOf(binding({ ui: { visibility: ["app"] } }))
    registry.checkBindings()
    expect(recorded(registry, "acme_show_x").resourceUri).toBeUndefined()
  })

  it("takes the URI a resource of another scheme keeps for its data", () => {
    registryOf(holding("acme", "Data", "https://data.example/x.json")).checkBindings()
  })
})
