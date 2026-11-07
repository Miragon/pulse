import type { ServerContext, ToolAnnotations } from "@modelcontextprotocol/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { ModulePlugin } from "./composition.js"
import type { ModuleServer } from "./module-server.js"
import { createModuleRegistry, type RecordedTool } from "./tool-registration.js"
import { appOnly, showToolBinding, strictToolInput } from "./widget-tool-bindings.js"

/** As loose as the registry takes it: the cases plant what the SDK's types would refuse. */
interface Config {
  title?: string
  description?: string
  inputSchema?: unknown
  annotations?: ToolAnnotations
  _meta?: Record<string, unknown>
}
type LooseRegister = (name: string, config: Config, callback: unknown) => unknown

const registerLoose = (server: ModuleServer, name: string, config: Config, callback: unknown) =>
  (server.registerTool as unknown as LooseRegister)(name, config, callback)

const LABEL = "test-root"
const FONT_ORIGIN = "https://mcp.example.com"
const CSP = { resourceDomains: [FONT_ORIGIN] }
const answer = () => ({ content: [{ type: "text" as const, text: "ok" }] })
const ctx = { mcpReq: { signal: new AbortController().signal } } as unknown as ServerContext

const pluginOf = (name: string, ...tools: [string, Config][]): ModulePlugin => ({
  name,
  register: (server) => {
    for (const [toolName, config] of tools) registerLoose(server, toolName, config, answer)
  },
})

const show = (name: string, title = "Thing"): [string, Config] => [
  name,
  { title, ...showToolBinding(name, title) },
]

const recorded = (registry: { tools: readonly RecordedTool[] }, name: string): RecordedTool => {
  const tool = registry.tools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`${name} was not recorded`)
  return tool
}

const advertised = (tool: RecordedTool) =>
  tool.config.inputSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" })

describe("createModuleRegistry: names two registrations share", () => {
  it("refuses a second tool of a name, naming both modules", () => {
    const registry = createModuleRegistry(undefined, LABEL)
    registry.register(pluginOf("alpha", ["x_list", {}]))
    expect(() => registry.register(pluginOf("beta", ["x_list", {}]))).toThrow(
      'Tool "x_list" is registered twice: by "alpha" and again by "beta". A server lists one tool per name, so rename one of them.',
    )
  })

  it("refuses a second prompt of a name, naming both modules", () => {
    const registry = createModuleRegistry(undefined, LABEL)
    const prompting = (name: string): ModulePlugin => ({
      name,
      register: (server) => {
        server.registerPrompt("draft", { description: "Drafts." }, () => ({ messages: [] }))
      },
    })
    registry.register(prompting("alpha"))
    expect(() => registry.register(prompting("beta"))).toThrow(
      'Prompt "draft" is registered twice: by "alpha" and again by "beta". A server lists one prompt per name, so rename one of them.',
    )
    expect(registry.prompts.map(({ owner }) => owner)).toEqual(["alpha"])
  })

  it("claims no name for a registration it refuses", () => {
    const registry = createModuleRegistry(undefined, LABEL)
    const loose: [string, Config] = ["x_show_a", { inputSchema: z.object({}) }]
    expect(() => registry.register(pluginOf("alpha", loose))).toThrow("lets an unknown key through")
    registry.register(pluginOf("beta", show("x_show_a")))
    expect(registry.tools.map(({ name, owner }) => [name, owner])).toEqual([["x_show_a", "beta"]])
    expect([...registry.views.keys()]).toEqual(["x_show_a"])
  })

  it("refuses a registration after the plugin's register returned, and a callback that is none", () => {
    const registry = createModuleRegistry(undefined, LABEL)
    let kept: ModuleServer | undefined
    registry.register({ name: "late", register: (server) => void (kept = server) })
    expect(() => kept!.registerTool("late_list", {}, answer)).toThrow(
      'Tool "late_list" registers after "late" returned from register(server)',
    )
    expect(() => kept!.registerPrompt("late_draft", {}, () => ({ messages: [] }))).toThrow(
      'Prompt "late_draft" registers after "late"',
    )
    const broken: ModulePlugin = {
      name: "broken",
      register: (server) => {
        registerLoose(server, "x_nothing", {}, undefined)
      },
    }
    expect(() => registry.register(broken)).toThrow('Tool "x_nothing" of "broken" has no callback.')
    const brokenPrompt: ModulePlugin = {
      name: "broken",
      register: (server) => {
        ;(server.registerPrompt as unknown as LooseRegister)("x_nothing", {}, 1)
      },
    }
    expect(() => registry.register(brokenPrompt)).toThrow(
      'Prompt "x_nothing" of "broken" has no callback.',
    )
  })

  it("hands back a handle that refuses to change what the boot replays", () => {
    const registry = createModuleRegistry(undefined, LABEL)
    let handle: ReturnType<ModuleServer["registerTool"]> | undefined
    let promptHandle: ReturnType<ModuleServer["registerPrompt"]> | undefined
    registry.register({
      name: "alpha",
      register: (server) => {
        handle = server.registerTool("x_list", { description: "Lists." }, answer)
        promptHandle = server.registerPrompt("x_draft", {}, () => ({ messages: [] }))
      },
    })
    expect(handle?.enabled).toBe(true)
    expect(handle?.description).toBe("Lists.")
    for (const change of [
      () => handle!.disable(),
      () => handle!.enable(),
      () => handle!.remove(),
      () => handle!.update({ description: "Other." }),
      () => promptHandle!.disable(),
    ]) {
      expect(change).toThrow("is fixed at boot")
    }
  })
})

describe("createModuleRegistry: strict input (invariant 5)", () => {
  const recordOne = (config: Config) => {
    const registry = createModuleRegistry(undefined, LABEL)
    registry.register(pluginOf("alpha", ["x_probe", config]))
    return recorded(registry, "x_probe")
  }

  it("keeps a strict schema and advertises it trimmed", () => {
    const tool = recordOne({
      inputSchema: strictToolInput({ id: z.string(), n: z.number().int() }),
    })
    expect(advertised(tool)).toEqual({
      type: "object",
      properties: { id: { type: "string" }, n: { type: "integer" } },
      required: ["id", "n"],
      additionalProperties: false,
    })
  })

  it("makes no input and a raw shape strict, naming the valid keys for an unknown one", async () => {
    const none = recordOne({})
    expect(advertised(none)).toMatchObject({ additionalProperties: false, properties: {} })
    const parsed = await none.config.inputSchema["~standard"].validate({ x: 1 })
    expect(parsed.issues?.map(({ message }) => message)).toEqual([
      'Unknown key "x". This tool takes no arguments.',
    ])
    const raw = recordOne({ inputSchema: { id: z.string() } })
    expect(advertised(raw)).toMatchObject({ additionalProperties: false, required: ["id"] })
  })

  it("refuses a schema that lets an unknown key through, and one that is no schema", () => {
    for (const inputSchema of [z.object({ id: z.string() }), z.looseObject({})]) {
      expect(() => recordOne({ inputSchema })).toThrow(
        'Tool "x_probe" of "alpha" takes input that lets an unknown key through: a misnamed argument would be dropped silently instead of failing the call. Build its inputSchema with strictToolInput(shape) (@miragon/pulse-widget-shell/server).',
      )
    }
    for (const inputSchema of [{ id: "string" }, "id", { "~standard": { validate: () => ({}) } }]) {
      expect(() => recordOne({ inputSchema })).toThrow(
        'Tool "x_probe" of "alpha" takes an inputSchema that is no Standard Schema with JSON Schema',
      )
    }
  })

  it("calls a tool registered without input with ctx alone, one with input with (args, ctx)", async () => {
    const seen: unknown[][] = []
    const registry = createModuleRegistry(undefined, LABEL)
    registry.register({
      name: "alpha",
      register: (server) => {
        server.registerTool("x_none", {}, (...args: unknown[]) => {
          seen.push(args)
          return answer()
        })
        server.registerTool(
          "x_some",
          { inputSchema: strictToolInput({ id: z.string() }) },
          (...args: unknown[]) => {
            seen.push(args)
            return answer()
          },
        )
      },
    })
    await recorded(registry, "x_none").handler({}, ctx)
    await recorded(registry, "x_some").handler({ id: "1" }, ctx)
    expect(seen).toEqual([[ctx], [{ id: "1" }, ctx]])
  })
})

describe("createModuleRegistry: writes of an unguarded module", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const crm = pluginOf(
    "crm",
    ["crm_list_customers", { annotations: { readOnlyHint: true, idempotentHint: true } }],
    ["crm_delete_customer", { annotations: { readOnlyHint: false, destructiveHint: true } }],
    // No annotations at all: MCP reads the absent hint as a write.
    ["crm_touch_customer", {}],
    show("crm_show_customer", "Customer"),
  )

  const warning = (tool: string) =>
    `[${LABEL}] ${tool} is a write and its module "crm" declares no toolsets: anyone who reaches this port can call it. Declare toolsets on "crm" that keep its writes out of the read-only floor, or configure an OAuth provider (MCP_OAUTH_*); a tool that only reads states readOnlyHint: true.`

  it("warns once per tool without readOnlyHint: true, naming it and the module, and records every tool", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const registry = createModuleRegistry(undefined, LABEL)
    registry.register(crm, { unguardedModule: "crm" })
    expect(warn.mock.calls.map(([line]) => String(line))).toEqual([
      warning("crm_delete_customer"),
      warning("crm_touch_customer"),
      warning("crm_show_customer"),
    ])
    expect(registry.tools.map(({ name }) => name)).toEqual([
      "crm_list_customers",
      "crm_delete_customer",
      "crm_touch_customer",
      "crm_show_customer",
    ])
  })

  it("warns about nothing of a guarded module, also after a plugin threw", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const registry = createModuleRegistry(undefined, LABEL)
    registry.register(crm)
    const failing: ModulePlugin = {
      name: "broken",
      register: () => {
        throw new Error("boom")
      },
    }
    expect(() => registry.register(failing, { unguardedModule: "broken" })).toThrow("boom")
    registry.register(pluginOf("other", ["x_reset_cache", {}]))
    expect(warn).not.toHaveBeenCalled()
  })
})

describe("createModuleRegistry: the views", () => {
  it("serves each bound view once, titled by its tool, and no feed or plain tool", () => {
    const registry = createModuleRegistry(CSP, LABEL)
    registry.register(
      pluginOf("alpha", show("x_show_a", "A"), ["x_a_data", { ...appOnly }], ["x_list_a", {}]),
    )
    registry.register(pluginOf("beta", show("y_show_b", "B")))
    expect([...registry.views]).toEqual([
      ["x_show_a", { description: "A", csp: CSP }],
      ["y_show_b", { description: "B", csp: CSP }],
    ])
    expect(recorded(registry, "x_show_a").resourceUri).toBe("ui://views/x_show_a.html")
    expect(recorded(registry, "x_a_data").view).toBeUndefined()
    expect(recorded(registry, "x_a_data").resourceUri).toBeUndefined()
    registry.checkBindings()
  })

  it("writes both spellings of the view, as registerAppTool does", () => {
    const registry = createModuleRegistry(undefined, LABEL)
    registry.register(
      pluginOf(
        "x",
        ["x_show_new", { _meta: { ui: { resourceUri: "ui://views/x_show_new.html" } } }],
        ["x_show_old", { _meta: { "ui/resourceUri": "ui://views/x_show_old.html" } }],
      ),
    )
    for (const name of ["x_show_new", "x_show_old"]) {
      const uri = `ui://views/${name}.html`
      expect(recorded(registry, name).config._meta).toEqual({
        ui: { resourceUri: uri },
        "ui/resourceUri": uri,
      })
      expect(recorded(registry, name).view).toBe(name)
    }
    expect([...registry.views.values()]).toEqual([{ csp: {} }, { csp: {} }])
  })

  const unserved = (uri: unknown) =>
    `Tool "x_show_map" of "x" binds ${JSON.stringify(uri)}, which this server does not serve: bind the view named after the tool, ui://views/<tool>.html, which the boot serves from the bundle (showToolBinding(name, title)), or a resource a module registers (registerAppResource, showToolBinding(name, title, { resourceUri })).`

  // A view re-runs the tool it is named after on a stripped result, so another tool's name is out.
  it("refuses a tool that binds anything under ui://views/ but the view of its own name", () => {
    for (const uri of [
      "ui://views/x_show_other.html",
      "ui://views/.html",
      "ui://views/a/b.html",
      "ui://views/x_show_map",
    ]) {
      const registry = createModuleRegistry(undefined, LABEL)
      const config: Config = { _meta: { ui: { resourceUri: uri } } }
      expect(() => registry.register(pluginOf("x", ["x_show_map", config]))).toThrow(unserved(uri))
    }
  })

  it("refuses a tool that binds a resource no module registers, once every plugin registered", () => {
    const registry = createModuleRegistry(undefined, LABEL)
    const config: Config = { _meta: { ui: { resourceUri: "ui://weather/view.html" } } }
    registry.register(pluginOf("x", ["x_show_map", config]))
    expect(() => registry.checkBindings()).toThrow(unserved("ui://weather/view.html"))
  })
})

describe("createModuleRegistry: the server-wide view CSP", () => {
  it("adds it to the view and, in Apps SDK spelling, to the widget tool's _meta", () => {
    const registry = createModuleRegistry(CSP, LABEL)
    registry.register(pluginOf("x", show("x_show_thing")))
    const tool = recorded(registry, "x_show_thing")
    expect(tool.config._meta?.["openai/widgetCSP"]).toEqual({ resource_domains: [FONT_ORIGIN] })
    expect(tool.config._meta?.["openai/outputTemplate"]).toBe("ui://views/x_show_thing.html")
    expect(registry.views.get("x_show_thing")).toEqual({ description: "Thing", csp: CSP })
  })

  it("keeps what a tool states itself first, on both halves, and never changes the tool's own _meta", () => {
    const registry = createModuleRegistry(CSP, LABEL)
    const [name, binding] = show("x_show_map")
    const own = {
      ...binding._meta,
      "openai/widgetCSP": {
        resource_domains: ["https://tiles.example"],
        connect_domains: ["https://api.example"],
      },
    }
    registry.register(pluginOf("x", [name, { ...binding, _meta: own }]))
    expect(recorded(registry, name).config._meta?.["openai/widgetCSP"]).toEqual({
      resource_domains: ["https://tiles.example", FONT_ORIGIN],
      connect_domains: ["https://api.example"],
    })
    expect(registry.views.get(name)?.csp).toEqual({
      resourceDomains: ["https://tiles.example", FONT_ORIGIN],
      connectDomains: ["https://api.example"],
    })
    expect(own["openai/widgetCSP"]).toEqual({
      resource_domains: ["https://tiles.example"],
      connect_domains: ["https://api.example"],
    })
  })

  it("leaves app-only feeds and plain tools as they are: nothing renders them", () => {
    const registry = createModuleRegistry(CSP, LABEL)
    registry.register(
      pluginOf("x", ["x_thing_data", { ...appOnly }], ["x_list", { description: "Lists." }]),
    )
    expect(recorded(registry, "x_thing_data").config._meta).toBe(appOnly._meta)
    expect(recorded(registry, "x_list").config._meta).toBeUndefined()
    expect(registry.views.size).toBe(0)
  })

  it("gives a view the Apps SDK never renders only the view half", () => {
    const registry = createModuleRegistry(CSP, LABEL)
    const uri = "ui://views/x_show_raw.html"
    registry.register(pluginOf("x", ["x_show_raw", { _meta: { ui: { resourceUri: uri } } }]))
    expect(recorded(registry, "x_show_raw").config._meta).toEqual({
      ui: { resourceUri: uri },
      "ui/resourceUri": uri,
    })
    expect(registry.views.get("x_show_raw")).toEqual({ csp: CSP })
  })

  it("adds nothing without a CSP or with an empty one", () => {
    for (const csp of [undefined, {}, { resourceDomains: [] }, { resourceDomains: undefined }]) {
      const registry = createModuleRegistry(csp, LABEL)
      registry.register(pluginOf("x", show("x_show_thing")))
      expect(recorded(registry, "x_show_thing").config._meta).not.toHaveProperty("openai/widgetCSP")
      expect(registry.views.get("x_show_thing")).toEqual({ description: "Thing", csp: {} })
    }
  })
})
