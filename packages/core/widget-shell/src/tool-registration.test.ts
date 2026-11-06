import { afterEach, describe, expect, it, vi } from "vitest"
import type { MCPServer } from "mcp-use"
import type { ModulePlugin } from "./composition.js"
import {
  installToolRegistration,
  mergeDomainLists,
  SERVER_TOOL_OWNER,
  toWidgetCspMeta,
} from "./tool-registration.js"
import { appOnly, showToolBinding } from "./widget-tool-bindings.js"

type Definition = Record<string, unknown> & {
  name: string
  view?: { name: string; csp?: Record<string, string[]> }
  _meta?: Record<string, unknown>
}

function recordingServer() {
  const definitions: Definition[] = []
  const server = {
    tool(definition: Definition) {
      definitions.push(definition)
      return { name: definition.name }
    },
  }
  return { server: server as unknown as MCPServer, definitions }
}

const LABEL = "test-root"
const FONT_ORIGIN = "https://mcp.example.com"
const CSP = { resourceDomains: [FONT_ORIGIN] }

const register = (server: MCPServer, definition: Definition) =>
  server.tool(definition as never, (() => ({ content: [] })) as never)

const pluginOf = (name: string, ...definitions: Definition[]): ModulePlugin => ({
  name,
  register: (server) => {
    for (const definition of definitions) register(server, definition)
  },
})

const show = (name: string): Definition => ({ name, ...showToolBinding(name, "Thing") })

describe("installToolRegistration: duplicate tool names", () => {
  it("refuses a second tool of a name, naming both modules", () => {
    const { server } = recordingServer()
    const registration = installToolRegistration(server, undefined, LABEL)
    registration.register(pluginOf("alpha", { name: "x_list" }))
    expect(() => registration.register(pluginOf("beta", { name: "x_list" }))).toThrow(
      'Tool "x_list" is registered twice: by "alpha" and again by "beta". mcp-use keeps one tool per name, so rename one of them.',
    )
  })

  it("names a registration outside any plugin as the server, also after a plugin threw", () => {
    const { server, definitions } = recordingServer()
    const registration = installToolRegistration(server, undefined, LABEL)
    register(server, { name: "x_ping" })
    expect(() => registration.register(pluginOf("alpha", { name: "x_ping" }))).toThrow(
      `by "${SERVER_TOOL_OWNER}" and again by "alpha"`,
    )
    expect(() => register(server, { name: "x_ping" })).toThrow(
      `by "${SERVER_TOOL_OWNER}" and again by "${SERVER_TOOL_OWNER}"`,
    )
    expect(definitions.map(({ name }) => name)).toEqual(["x_ping"])
  })

  it("claims no name for a registration mcp-use refuses", () => {
    let refuse = true
    const definitions: string[] = []
    const server = {
      tool(definition: Definition) {
        if (refuse) throw new TypeError("refused")
        definitions.push(definition.name)
      },
    } as unknown as MCPServer
    const registration = installToolRegistration(server, undefined, LABEL)
    expect(() => registration.register(pluginOf("alpha", show("x_show_a")))).toThrow("refused")
    refuse = false
    registration.register(pluginOf("beta", show("x_show_a")))
    expect(definitions).toEqual(["x_show_a"])
    expect([...registration.viewNames]).toEqual(["x_show_a"])
  })
})

describe("installToolRegistration: writes of an unguarded module", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const crm = pluginOf(
    "crm",
    { name: "crm_list_customers", annotations: { readOnlyHint: true, idempotentHint: true } },
    { name: "crm_delete_customer", annotations: { readOnlyHint: false, destructiveHint: true } },
    // No annotations at all: MCP reads the absent hint as a write.
    { name: "crm_touch_customer" },
    { name: "crm_show_customer", ...showToolBinding("crm_show_customer", "Customer") },
  )

  const warning = (tool: string) =>
    `[${LABEL}] ${tool} is a write and its module "crm" declares no toolsets: anyone who reaches this port can call it. Declare toolsets on "crm" or configure an OAuth provider (MCP_USE_OAUTH_*); a tool that only reads states readOnlyHint: true.`

  it("warns once per tool without readOnlyHint: true, naming it and the module, and registers every tool", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { server, definitions } = recordingServer()
    installToolRegistration(server, undefined, LABEL).register(crm, { unguardedModule: "crm" })
    expect(warn.mock.calls.map(([line]) => String(line))).toEqual([
      warning("crm_delete_customer"),
      warning("crm_touch_customer"),
      warning("crm_show_customer"),
    ])
    expect(definitions.map(({ name }) => name)).toEqual([
      "crm_list_customers",
      "crm_delete_customer",
      "crm_touch_customer",
      "crm_show_customer",
    ])
  })

  it("warns about nothing of a guarded module, nor outside a plugin, also after a plugin threw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { server } = recordingServer()
    const registration = installToolRegistration(server, undefined, LABEL)
    registration.register(crm)
    const failing: ModulePlugin = {
      name: "broken",
      register: () => {
        throw new Error("boom")
      },
    }
    expect(() => registration.register(failing, { unguardedModule: "broken" })).toThrow("boom")
    register(server, { name: "x_reset_cache" })
    expect(warn).not.toHaveBeenCalled()
  })
})

describe("installToolRegistration: view names", () => {
  it("records each bound view once and no feed or plain tool", () => {
    const { server } = recordingServer()
    const registration = installToolRegistration(server, CSP, LABEL)
    registration.register(
      pluginOf(
        "alpha",
        show("x_show_a"),
        { name: "x_a_data", ...appOnly },
        { name: "x_list_a" },
        // Two tools may share one view.
        { name: "x_show_a_again", view: { name: "x_show_a" } },
      ),
    )
    registration.register(pluginOf("beta", show("y_show_b")))
    expect([...registration.viewNames]).toEqual(["x_show_a", "y_show_b"])
  })
})

describe("installToolRegistration: the server-wide view CSP", () => {
  it("adds it to a view binding and, in Apps SDK spelling, to the widget tool's _meta", () => {
    const { server, definitions } = recordingServer()
    installToolRegistration(server, CSP, LABEL).register(pluginOf("x", show("x_show_thing")))
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

  it("keeps what a tool states itself first, appends each origin once and copies the definition", () => {
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
    installToolRegistration(server, CSP, LABEL).register(pluginOf("x", own))
    const [definition] = definitions
    expect(definition.view?.csp).toEqual({
      resourceDomains: ["https://tiles.example", FONT_ORIGIN],
      connectDomains: ["https://api.example"],
    })
    expect(definition._meta?.["openai/widgetCSP"]).toEqual({
      resource_domains: ["https://tiles.example", FONT_ORIGIN],
    })
    expect(own.view?.csp?.resourceDomains).toEqual(["https://tiles.example", FONT_ORIGIN])
    expect(own._meta?.["openai/widgetCSP"]).toEqual({ resource_domains: ["https://tiles.example"] })
    expect(definition).not.toBe(own)
  })

  it("leaves app-only feeds and plain tools as they are: nothing renders them", () => {
    const { server, definitions } = recordingServer()
    const feed: Definition = { name: "x_thing_data", ...appOnly }
    const plain: Definition = { name: "x_list_things", description: "Lists things." }
    installToolRegistration(server, CSP, LABEL).register(pluginOf("x", feed, plain))
    expect(definitions).toEqual([feed, plain])
    expect(definitions[0]._meta).toEqual({ "openai/widgetAccessible": true })
  })

  it("gives a view the Apps SDK never renders only the view half", () => {
    const { server, definitions } = recordingServer()
    const viewOnly: Definition = { name: "x_show_raw", view: { name: "x_show_raw" } }
    installToolRegistration(server, CSP, LABEL).register(pluginOf("x", viewOnly))
    expect(definitions[0]).toEqual({ ...viewOnly, view: { name: "x_show_raw", csp: CSP } })
  })

  it("passes every definition through untouched without a CSP or with an empty one", () => {
    for (const csp of [undefined, {}, { resourceDomains: [] }, { resourceDomains: undefined }]) {
      const { server, definitions } = recordingServer()
      const definition = show("x_show_thing")
      installToolRegistration(server, csp, LABEL).register(pluginOf("x", definition))
      expect(definitions[0]).toBe(definition)
    }
  })
})

describe("toWidgetCspMeta", () => {
  it("spells each list the Apps SDK way and leaves absent ones out", () => {
    expect(
      toWidgetCspMeta({
        connectDomains: ["https://c"],
        resourceDomains: ["https://r"],
        frameDomains: ["https://f"],
        baseUriDomains: ["https://b"],
      }),
    ).toEqual({
      connect_domains: ["https://c"],
      resource_domains: ["https://r"],
      frame_domains: ["https://f"],
      base_uri_domains: ["https://b"],
    })
    expect(toWidgetCspMeta({})).toEqual({})
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
