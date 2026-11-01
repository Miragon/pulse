import type { MCPServer, ToolDefinition } from "mcp-use"
import type { ModulePlugin } from "./composition.js"

/** Owner of a tool registered outside a plugin's `register`. */
export const SERVER_TOOL_OWNER = "server"

/** A view's CSP in the SEP-1865 spelling mcp-use takes on `view.csp`: origins other than the server's own. */
export interface AppResourceCsp {
  connectDomains?: string[]
  resourceDomains?: string[]
  frameDomains?: string[]
  baseUriDomains?: string[]
}

/** The Apps SDK spelling of {@link AppResourceCsp}. */
export interface WidgetCspMeta {
  connect_domains?: string[]
  resource_domains?: string[]
  frame_domains?: string[]
  base_uri_domains?: string[]
}

export interface ToolRegistration {
  /** Every `view.name` a registered tool binds; the boot primes them once, after every plugin. */
  readonly viewNames: ReadonlySet<string>
  /** Runs `plugin.register` with the plugin's name as the owner of every tool it adds. */
  register(plugin: ModulePlugin): void
}

type Register = (definition: ToolDefinition, callback: never) => unknown
type Lists = Readonly<Record<string, readonly string[] | undefined>>

/** Feeds never carry it, so it marks the tools Apps SDK hosts render. */
const OUTPUT_TEMPLATE = "openai/outputTemplate"
const WIDGET_CSP = "openai/widgetCSP"

export function toWidgetCspMeta(csp: AppResourceCsp): WidgetCspMeta {
  const meta: WidgetCspMeta = {}
  if (csp.connectDomains) meta.connect_domains = csp.connectDomains
  if (csp.resourceDomains) meta.resource_domains = csp.resourceDomains
  if (csp.frameDomains) meta.frame_domains = csp.frameDomains
  if (csp.baseUriDomains) meta.base_uri_domains = csp.baseUriDomains
  return meta
}

/** The tool's own entries come first; each default origin is appended once. */
export function mergeDomainLists<T extends object>(own: T | undefined, defaults: T): T {
  const mine = (own ?? {}) as Lists
  const merged: Record<string, unknown> = { ...mine }
  for (const [key, domains] of Object.entries(defaults as Lists)) {
    if (!domains?.length) continue
    merged[key] = [...new Set([...(mine[key] ?? []), ...domains])]
  }
  return merged as T
}

const hasDomains = (lists: object | undefined): lists is object =>
  lists !== undefined && Object.values(lists as Lists).some((domains) => (domains?.length ?? 0) > 0)

function withCspDefaults(definition: ToolDefinition, csp: AppResourceCsp): ToolDefinition {
  const { view, _meta: meta } = definition
  const next: Record<string, unknown> = { ...definition }
  if (view) next.view = { ...view, csp: mergeDomainLists(view.csp as AppResourceCsp, csp) }
  if (meta?.[OUTPUT_TEMPLATE] !== undefined) {
    const own = meta[WIDGET_CSP] as WidgetCspMeta | undefined
    next._meta = { ...meta, [WIDGET_CSP]: mergeDomainLists(own, toWidgetCspMeta(csp)) }
  }
  return next as unknown as ToolDefinition
}

/**
 * Wraps `server.tool` before any plugin registers. mcp-use keeps the last tool of a name, so a
 * second module's tool would silently replace the first: the boot refuses it instead. Modules bind
 * views through `showToolBinding`, which knows nothing about the deployment, so the server-wide view
 * CSP (the served fonts' origin) is merged in here.
 */
export function installToolRegistration(
  server: MCPServer,
  csp: AppResourceCsp | undefined,
): ToolRegistration {
  const owners = new Map<string, string>()
  const viewNames = new Set<string>()
  const defaults = hasDomains(csp) ? csp : undefined
  let owner = SERVER_TOOL_OWNER

  // `never` keeps the assignment sound under parameter contravariance: the wrapper only forwards it.
  const original: Register = server.tool.bind(server)
  const guarded: Register = (definition, callback) => {
    const previous = owners.get(definition.name)
    if (previous !== undefined) {
      throw new Error(
        `Tool "${definition.name}" is registered twice: by "${previous}" and again by "${owner}". ` +
          "mcp-use keeps one tool per name, so rename one of them.",
      )
    }
    const ref = original(defaults ? withCspDefaults(definition, defaults) : definition, callback)
    owners.set(definition.name, owner)
    if (definition.view?.name) viewNames.add(definition.view.name)
    return ref
  }
  server.tool = guarded as typeof server.tool

  return {
    viewNames,
    register(plugin) {
      owner = plugin.name
      try {
        plugin.register(server)
      } finally {
        owner = SERVER_TOOL_OWNER
      }
    },
  }
}
