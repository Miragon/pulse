import { describe, expect, it, vi } from "vitest"
import type { AppPlugin } from "@miragon/mcp-toolkit-core"
import type { MCPServer } from "mcp-use"
import { appOnly, showToolBinding } from "./widget-tool-bindings.js"
import {
  honorWidgetMetaDefaults,
  mergeDomainLists,
  withWidgetMetaDefaults,
  type WidgetMetaDefaults,
} from "./widget-meta-defaults.js"

type Definition = Record<string, unknown> & {
  name: string
  view?: { name: string; csp?: Record<string, string[]> }
  _meta?: Record<string, unknown>
}

function recordingServer() {
  const definitions: Definition[] = []
  const server = {
    basePath: "/mcp",
    tool(definition: Definition) {
      definitions.push(definition)
      return { name: definition.name }
    },
    describe() {
      return `${this.basePath} with ${definitions.length} tools`
    },
  }
  return { server: server as unknown as MCPServer, definitions }
}

const FONT_ORIGIN = "https://mcp.example.com"
const DEFAULTS: WidgetMetaDefaults = {
  viewCsp: { resourceDomains: [FONT_ORIGIN] },
  widgetCSP: { resource_domains: [FONT_ORIGIN] },
}

const register = (server: MCPServer, definition: Definition) =>
  server.tool(definition as never, (() => ({ content: [] })) as never)

describe("withWidgetMetaDefaults", () => {
  it("adds the view CSP to a view binding and the Apps SDK CSP to the widget tool's _meta", () => {
    const { server, definitions } = recordingServer()
    register(withWidgetMetaDefaults(server, DEFAULTS), {
      name: "x_show_thing",
      ...showToolBinding("x_show_thing", "Thing"),
    })
    const [definition] = definitions
    expect(definition.view).toEqual({
      name: "x_show_thing",
      description: "Thing",
      prefersBorder: true,
      csp: { resourceDomains: [FONT_ORIGIN] },
    })
    expect(definition._meta?.["openai/widgetCSP"]).toEqual({ resource_domains: [FONT_ORIGIN] })
    expect(definition._meta?.["openai/outputTemplate"]).toBe("ui://views/x_show_thing.html")
  })

  it("keeps what a tool states itself first and appends each default origin once", () => {
    const { server, definitions } = recordingServer()
    const own: Definition = {
      name: "x_show_map",
      view: {
        name: "x_show_map",
        csp: {
          resourceDomains: ["https://tiles.example", FONT_ORIGIN],
          connectDomains: ["https://api.example"],
        },
      },
      _meta: {
        "openai/outputTemplate": "ui://views/x_show_map.html",
        "openai/widgetCSP": { resource_domains: ["https://tiles.example"] },
      },
    }
    register(withWidgetMetaDefaults(server, DEFAULTS), own)
    const [definition] = definitions
    expect(definition.view?.csp).toEqual({
      resourceDomains: ["https://tiles.example", FONT_ORIGIN],
      connectDomains: ["https://api.example"],
    })
    expect(definition._meta?.["openai/widgetCSP"]).toEqual({
      resource_domains: ["https://tiles.example", FONT_ORIGIN],
    })
    // A copy: the caller's definition is untouched.
    expect(own.view?.csp?.resourceDomains).toEqual(["https://tiles.example", FONT_ORIGIN])
    expect(own._meta?.["openai/widgetCSP"]).toEqual({ resource_domains: ["https://tiles.example"] })
    expect(definition).not.toBe(own)
  })

  it("leaves app-only feeds and plain tools as they are — nothing renders them", () => {
    const { server, definitions } = recordingServer()
    const bound = withWidgetMetaDefaults(server, DEFAULTS)
    const feed: Definition = { name: "x_thing_data", ...appOnly }
    const plain: Definition = { name: "x_list_things", description: "Lists things." }
    register(bound, feed)
    register(bound, plain)
    expect(definitions).toEqual([feed, plain])
    expect(definitions[0]._meta).toEqual({ "openai/widgetAccessible": true })
  })

  it("applies each half on its own: a view CSP without an Apps SDK CSP and the other way round", () => {
    const { server, definitions } = recordingServer()
    const binding = showToolBinding("x_show_a", "A")
    register(withWidgetMetaDefaults(server, { viewCsp: DEFAULTS.viewCsp }), {
      name: "x_show_a",
      ...binding,
    })
    register(withWidgetMetaDefaults(server, { widgetCSP: DEFAULTS.widgetCSP }), {
      name: "x_show_a",
      ...binding,
    })
    expect(definitions[0].view?.csp).toEqual({ resourceDomains: [FONT_ORIGIN] })
    expect(definitions[0]._meta?.["openai/widgetCSP"]).toBeUndefined()
    expect(definitions[1].view?.csp).toBeUndefined()
    expect(definitions[1]._meta?.["openai/widgetCSP"]).toEqual({ resource_domains: [FONT_ORIGIN] })
  })

  it("is the server itself without defaults (or with empty ones)", () => {
    const { server } = recordingServer()
    expect(withWidgetMetaDefaults(server, undefined)).toBe(server)
    expect(withWidgetMetaDefaults(server, {})).toBe(server)
    expect(
      withWidgetMetaDefaults(server, { viewCsp: { resourceDomains: [] }, widgetCSP: {} }),
    ).toBe(server)
    expect(
      withWidgetMetaDefaults(server, {
        viewCsp: { resourceDomains: undefined },
        widgetCSP: { resource_domains: undefined },
      }),
    ).toBe(server)
  })

  it("forwards every other member to the real server, bound to it", () => {
    const { server } = recordingServer()
    const bound = withWidgetMetaDefaults(server, DEFAULTS) as unknown as {
      basePath: string
      describe: () => string
    }
    register(bound as unknown as MCPServer, { name: "x_list" })
    expect(bound.basePath).toBe("/mcp")
    const { describe: describeServer } = bound
    expect(describeServer()).toBe("/mcp with 1 tools")
  })
})

describe("honorWidgetMetaDefaults", () => {
  it("hands the plugin's registerWidgetTools a server that applies the toolkit's defaults", () => {
    const { server, definitions } = recordingServer()
    const seen: unknown[] = []
    const plugin: AppPlugin<MCPServer> = {
      definition: { name: "x", steps: [], widgets: [] },
      registerWidgetTools: (target, defaults) => {
        seen.push(defaults)
        register(target, { name: "x_show_thing", ...showToolBinding("x_show_thing", "Thing") })
      },
    }
    honorWidgetMetaDefaults(plugin).registerWidgetTools!(server, DEFAULTS)
    expect(seen).toEqual([DEFAULTS])
    expect(definitions[0].view?.csp).toEqual({ resourceDomains: [FONT_ORIGIN] })
  })

  it("keeps a class-based plugin whole: prototype hooks, one shared `this`, private fields", () => {
    const { server, definitions } = recordingServer()
    class BillingPlugin implements AppPlugin<MCPServer> {
      definition = { name: "billing", steps: [], widgets: [] }
      appConfig = { region: "eu" }
      readonly #client = "billing-client"
      registeredWith: string | undefined
      registerTools(target: MCPServer) {
        this.registeredWith = this.#client
        register(target, { name: "billing_list_invoices" })
      }
      registerWidgetTools(target: MCPServer) {
        register(target, {
          name: "billing_show_invoice",
          description: `${this.#client} after ${this.registeredWith}`,
          ...showToolBinding("billing_show_invoice", "Invoice"),
        })
      }
    }
    const plugin = new BillingPlugin()
    const wrapped = honorWidgetMetaDefaults(plugin)
    // The toolkit reads both hooks off the plugin and calls them as methods.
    wrapped.registerTools?.(server)
    wrapped.registerWidgetTools?.(server, DEFAULTS)
    expect(definitions.map((definition) => definition.name)).toEqual([
      "billing_list_invoices",
      "billing_show_invoice",
    ])
    // registerTools wrote to the plugin itself; registerWidgetTools read it back there.
    expect(plugin.registeredWith).toBe("billing-client")
    expect(definitions[1].description).toBe("billing-client after billing-client")
    expect(definitions[1].view?.csp).toEqual({ resourceDomains: [FONT_ORIGIN] })
    expect(wrapped.definition).toBe(plugin.definition)
    expect(wrapped.appConfig).toBe(plugin.appConfig)
    expect(wrapped).toBeInstanceOf(BillingPlugin)
  })

  it("calls a method-shorthand hook on the plugin itself, even on a frozen plugin", () => {
    const { server, definitions } = recordingServer()
    const plugin = Object.freeze({
      definition: { name: "z", steps: [], widgets: [] },
      toolName: "z_show_thing",
      registerWidgetTools(target: MCPServer) {
        register(target, { name: this.toolName, ...showToolBinding(this.toolName, "Thing") })
      },
    })
    honorWidgetMetaDefaults(plugin).registerWidgetTools?.(server, DEFAULTS)
    expect(definitions[0].name).toBe("z_show_thing")
    expect(definitions[0].view?.csp).toEqual({ resourceDomains: [FONT_ORIGIN] })
  })

  it("passes a plugin without widget tools through unchanged", () => {
    const registerTools = vi.fn()
    const plugin: AppPlugin<MCPServer> = {
      definition: { name: "y", steps: [], widgets: [] },
      registerTools,
    }
    expect(honorWidgetMetaDefaults(plugin)).toBe(plugin)
  })
})

describe("mergeDomainLists", () => {
  it("appends each default list to the tool's own, each entry once, and skips empty ones", () => {
    expect(
      mergeDomainLists<Record<string, string[] | undefined>>(
        { a: ["1"], b: ["2"] },
        { a: ["1", "3"], c: ["4"], d: [], e: undefined },
      ),
    ).toEqual({ a: ["1", "3"], b: ["2"], c: ["4"] })
    expect(mergeDomainLists(undefined, { a: ["1"] })).toEqual({ a: ["1"] })
  })
})
