/**
 * Applies the app's widget CSP defaults to every view-bound tool: modules
 * register through `showToolBinding`, which knows nothing about the app, so
 * `createComposedServer` wraps each plugin once. The tool's own entries come first.
 */
import type { AppPlugin, AppResourceCsp } from "@miragon/mcp-toolkit-core"
import type { MCPServer } from "mcp-use"

/** Not exported by the toolkit. */
export type WidgetMetaDefaults = NonNullable<
  Parameters<NonNullable<AppPlugin["registerWidgetTools"]>>[1]
>

type ToolDefinition = Parameters<MCPServer["tool"]>[0]
type ToolCallback = Parameters<MCPServer["tool"]>[1]
type DomainLists = object
type Lists = Readonly<Record<string, readonly string[] | undefined>>

/** Feeds never carry it. */
const OUTPUT_TEMPLATE = "openai/outputTemplate"
const WIDGET_CSP = "openai/widgetCSP"

export function mergeDomainLists<T extends DomainLists>(own: T | undefined, defaults: T): T {
  const mine = (own ?? {}) as Lists
  const merged: Record<string, unknown> = { ...mine }
  for (const [key, domains] of Object.entries(defaults as Lists)) {
    if (!domains?.length) continue
    merged[key] = [...new Set([...(mine[key] ?? []), ...domains])]
  }
  return merged as T
}

const hasDomains = (lists: DomainLists | undefined): lists is DomainLists =>
  lists !== undefined && Object.values(lists as Lists).some((domains) => (domains?.length ?? 0) > 0)

function withDefaults(definition: ToolDefinition, defaults: WidgetMetaDefaults): ToolDefinition {
  const { view, _meta: meta } = definition as {
    view?: { csp?: AppResourceCsp }
    _meta?: Record<string, unknown>
  }
  const next: Record<string, unknown> = { ...definition }
  if (view && defaults.viewCsp && hasDomains(defaults.viewCsp)) {
    next.view = { ...view, csp: mergeDomainLists(view.csp, defaults.viewCsp) }
  }
  if (
    meta?.[OUTPUT_TEMPLATE] !== undefined &&
    defaults.widgetCSP &&
    hasDomains(defaults.widgetCSP)
  ) {
    const own = meta[WIDGET_CSP] as DomainLists | undefined
    next._meta = { ...meta, [WIDGET_CSP]: mergeDomainLists(own, defaults.widgetCSP) }
  }
  return next as unknown as ToolDefinition
}

/** A Proxy, not a copy, so mcp-use's internals and the toolkit's per-module tool owner keep working. */
export function withWidgetMetaDefaults(
  server: MCPServer,
  defaults: WidgetMetaDefaults | undefined,
): MCPServer {
  if (!defaults || (!hasDomains(defaults.viewCsp) && !hasDomains(defaults.widgetCSP))) {
    return server
  }
  return new Proxy(server, {
    get(target, property) {
      if (property === "tool") {
        return (definition: ToolDefinition, callback: ToolCallback) =>
          target.tool(withDefaults(definition, defaults), callback)
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? (value as () => unknown).bind(target) : value
    },
  })
}

/**
 * A Proxy, not a spread: a spread would drop a class-based module's prototype
 * hooks. Hooks run with the plugin as `this`. The target is a child of the
 * plugin so a frozen plugin can still be wrapped.
 */
export function honorWidgetMetaDefaults(plugin: AppPlugin<MCPServer>): AppPlugin<MCPServer> {
  const register = plugin.registerWidgetTools
  if (!register) return plugin
  const registerWidgetTools: typeof register = (server, defaults) => {
    register.call(plugin, withWidgetMetaDefaults(server, defaults), defaults)
  }
  return new Proxy(Object.create(plugin) as AppPlugin<MCPServer>, {
    get(_child, property) {
      if (property === "registerWidgetTools") return registerWidgetTools
      const value: unknown = Reflect.get(plugin, property, plugin)
      return typeof value === "function" ? (value as () => unknown).bind(plugin) : value
    },
  })
}
