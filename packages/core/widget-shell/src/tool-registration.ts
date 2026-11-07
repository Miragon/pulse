/**
 * The boot's record of what the modules register. Each plugin's `register(server)` gets a
 * `ModuleServer`, the official SDK server's two registration methods, and the boot records every
 * call ONCE, checked: a name two registrations share fails the boot naming both owners; a tool's
 * input is strict (CLAUDE.md invariant 5) and its advertised schema trimmed; a view-bound tool
 * names a view this server serves and gets the server-wide view CSP. `McpHttpApp` replays the
 * record into a fresh `McpServer` per request, so nothing can change it once the boot is done.
 */
import type {
  CallToolResult,
  InputRequiredResult,
  RegisteredPrompt,
  RegisteredTool,
  ServerContext,
  StandardSchemaWithJSON,
  ToolAnnotations,
} from "@modelcontextprotocol/server"
import type { z } from "zod"
import type { ModulePlugin } from "./composition.js"
import type { ModuleServer } from "./module-server.js"
import { trimInputSchema } from "./tool-schema-trim.js"
import type { AppResourceCsp, ViewBinding } from "./view-resource.js"
import { strictToolInput, viewNameOf, viewResourceUri } from "./widget-tool-bindings.js"

/** The Apps SDK spelling of {@link AppResourceCsp}. */
export interface WidgetCspMeta {
  connect_domains?: string[]
  resource_domains?: string[]
  frame_domains?: string[]
  base_uri_domains?: string[]
}

type ToolResult = CallToolResult | InputRequiredResult

/** A tool's callback as the boot replays it: always `(args, ctx)`, also for a tool without input. */
type RecordedToolHandler = (args: unknown, ctx: ServerContext) => ToolResult | Promise<ToolResult>

/** A tool's config as the SDK takes it, with the boot's `inputSchema` (strict, trimmed) and `_meta`. */
interface RecordedToolConfig {
  title?: string
  description?: string
  inputSchema: StandardSchemaWithJSON
  outputSchema?: StandardSchemaWithJSON
  annotations?: ToolAnnotations
  _meta?: Record<string, unknown>
}

export interface RecordedTool {
  name: string
  /** The plugin that registered it. */
  owner: string
  config: RecordedToolConfig
  handler: RecordedToolHandler
  /** The view it binds (`ui://views/<view>.html`); the boot serves it. */
  view?: string
}

export interface RecordedPrompt {
  name: string
  owner: string
  /** As registered; the SDK reads `argsSchema` and calls `callback` with or without args by it. */
  config: PromptConfigInput
  callback: unknown
}

/** What the boot serves: every module's tools and prompts, and each bound view once. */
export interface ModuleRegistrations {
  readonly tools: readonly RecordedTool[]
  readonly prompts: readonly RecordedPrompt[]
  readonly views: ReadonlyMap<string, ViewBinding>
}

interface RegisterOptions {
  /**
   * The module's name when nothing narrows its tools on this boot (`unguardedModules`: no
   * toolsets, no OAuth). Each tool it adds without `readOnlyHint: true` then warns once.
   */
  unguardedModule?: string
}

export interface ModuleRegistry extends ModuleRegistrations {
  /** Runs `plugin.register` on a `ModuleServer` that records under the plugin's name. */
  register(plugin: ModulePlugin, options?: RegisterOptions): void
}

/** What `registerTool` takes, as loose as every SDK overload is: the record checks the rest. */
interface ToolConfigInput {
  title?: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  annotations?: ToolAnnotations
  _meta?: Record<string, unknown>
}

interface PromptConfigInput {
  title?: string
  description?: string
  argsSchema?: unknown
}

type Lists = Readonly<Record<string, readonly string[] | undefined>>
type AnyCallback = (...args: unknown[]) => ToolResult | Promise<ToolResult>

/** Feeds never carry it, so it marks the tools Apps SDK hosts render. */
const OUTPUT_TEMPLATE = "openai/outputTemplate"
const WIDGET_CSP = "openai/widgetCSP"
const FLAT_RESOURCE_URI = "ui/resourceUri"
const JSON_SCHEMA_TARGET = "draft-2020-12"

export function toWidgetCspMeta(csp: AppResourceCsp): WidgetCspMeta {
  const meta: WidgetCspMeta = {}
  if (csp.connectDomains) meta.connect_domains = csp.connectDomains
  if (csp.resourceDomains) meta.resource_domains = csp.resourceDomains
  if (csp.frameDomains) meta.frame_domains = csp.frameDomains
  if (csp.baseUriDomains) meta.base_uri_domains = csp.baseUriDomains
  return meta
}

/** The SEP-1865 spelling of an Apps SDK `openai/widgetCSP`. */
export function fromWidgetCspMeta(meta: WidgetCspMeta | undefined): AppResourceCsp {
  const csp: AppResourceCsp = {}
  if (meta?.connect_domains) csp.connectDomains = meta.connect_domains
  if (meta?.resource_domains) csp.resourceDomains = meta.resource_domains
  if (meta?.frame_domains) csp.frameDomains = meta.frame_domains
  if (meta?.base_uri_domains) csp.baseUriDomains = meta.base_uri_domains
  return csp
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isStandardSchema = (value: unknown): value is StandardSchemaWithJSON =>
  isRecord(value) && isRecord(value["~standard"])

/** The SDK's legacy `inputSchema` form: a plain record of zod schemas. */
function isRawShape(value: unknown): value is z.ZodRawShape {
  if (!isRecord(value) || isStandardSchema(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  if (proto !== Object.prototype && proto !== null) return false
  return Object.values(value).every((field) => isRecord(field) && "_zod" in field)
}

/** One line per open write; MCP reads an absent `readOnlyHint` as a write, so only `true` is a read. */
function openWriteWarning(label: string, tool: string, module: string): string {
  return (
    `[${label}] ${tool} is a write and its module "${module}" declares no toolsets: anyone who ` +
    `reaches this port can call it. Declare toolsets on "${module}" that keep its writes out of ` +
    `the read-only floor, or configure an OAuth provider (MCP_OAUTH_*); a tool that only ` +
    `reads states readOnlyHint: true.`
  )
}

interface StrictInput {
  schema: StandardSchemaWithJSON
  /** False for a tool registered without input: the SDK calls its callback with `ctx` alone. */
  takesArgs: boolean
}

/**
 * Every tool takes strict input (CLAUDE.md invariant 5): no input or a raw shape becomes
 * `strictToolInput`, and a schema that lets an unknown key through fails the boot, since the
 * misnamed filter it drops would silently widen the result (#329).
 */
function strictInput(tool: string, owner: string, schema: unknown): StrictInput {
  if (schema === undefined) return { schema: strictToolInput({}), takesArgs: false }
  if (isRawShape(schema)) return { schema: strictToolInput(schema), takesArgs: true }
  const convert = isStandardSchema(schema) ? schema["~standard"].jsonSchema?.input : undefined
  if (!isStandardSchema(schema) || typeof convert !== "function") {
    throw new TypeError(
      `Tool "${tool}" of "${owner}" takes an inputSchema that is no Standard Schema with JSON ` +
        "Schema: build it with strictToolInput(shape) (@miragon/pulse-widget-shell/server).",
    )
  }
  if (convert({ target: JSON_SCHEMA_TARGET }).additionalProperties !== false) {
    throw new Error(
      `Tool "${tool}" of "${owner}" takes input that lets an unknown key through: a misnamed ` +
        "argument would be dropped silently instead of failing the call. Build its inputSchema " +
        "with strictToolInput(shape) (@miragon/pulse-widget-shell/server).",
    )
  }
  return { schema, takesArgs: true }
}

/** The view a tool binds: MCP Apps' `_meta.ui.resourceUri`, else the flat key older hosts read. */
function boundView(tool: string, meta: Record<string, unknown> | undefined): string | undefined {
  const uri = (isRecord(meta?.ui) ? meta.ui.resourceUri : undefined) ?? meta?.[FLAT_RESOURCE_URI]
  if (uri === undefined) return undefined
  const view = viewNameOf(uri)
  if (view === undefined) {
    throw new Error(
      `Tool "${tool}" binds ${JSON.stringify(uri)}, which this server does not serve: it serves ` +
        "one view per tool, ui://views/<name>.html (showToolBinding(name, title)).",
    )
  }
  return view
}

/**
 * A view-bound tool's `_meta`: both spellings of its view (as `registerAppTool` writes them) and,
 * for Apps SDK hosts, the server-wide view CSP merged into its own `openai/widgetCSP`. Copied,
 * never mutated: `showToolBinding` and `appOnly` parts are shared.
 */
function viewToolMeta(
  meta: Record<string, unknown> | undefined,
  view: string,
  defaults: AppResourceCsp | undefined,
): Record<string, unknown> {
  const resourceUri = viewResourceUri(view)
  const ui = isRecord(meta?.ui) ? meta.ui : {}
  const next: Record<string, unknown> = {
    ...meta,
    ui: { ...ui, resourceUri },
    [FLAT_RESOURCE_URI]: resourceUri,
  }
  if (defaults && next[OUTPUT_TEMPLATE] !== undefined) {
    const own = next[WIDGET_CSP] as WidgetCspMeta | undefined
    next[WIDGET_CSP] = mergeDomainLists(own, toWidgetCspMeta(defaults))
  }
  return next
}

/**
 * The handle `registerTool`/`registerPrompt` return. Every request gets its own `McpServer` from
 * the record, so a handle could change nothing a client sees: it refuses instead of pretending.
 */
function fixedHandle(kind: "Tool" | "Prompt", name: string, config: object) {
  const refuse = (): never => {
    throw new Error(
      `${kind} "${name}" is fixed at boot: the server replays every registration into each ` +
        "request's own McpServer, so its handle cannot enable, disable, update or remove it.",
    )
  }
  return {
    ...config,
    enabled: true,
    enable: refuse,
    disable: refuse,
    update: refuse,
    remove: refuse,
  }
}

function refuseLate(open: boolean, owner: string, kind: "Tool" | "Prompt", name: string): void {
  if (open) return
  throw new Error(
    `${kind} "${name}" registers after "${owner}" returned from register(server): the boot ` +
      "records every registration once, so register it inside register(server).",
  )
}

/**
 * The boot's one registry: `label` prefixes the open-write warning, `csp` is the server-wide view
 * CSP (the served fonts' origin), which every view and, in Apps SDK spelling, every widget tool
 * gets on top of what the tool states itself.
 */
export function createModuleRegistry(
  csp: AppResourceCsp | undefined,
  label: string,
): ModuleRegistry {
  const tools: RecordedTool[] = []
  const prompts: RecordedPrompt[] = []
  const views = new Map<string, ViewBinding>()
  const toolOwners = new Map<string, string>()
  const promptOwners = new Map<string, string>()
  const defaults = hasDomains(csp) ? csp : undefined

  function claim(owners: Map<string, string>, kind: string, name: string, owner: string): void {
    const previous = owners.get(name)
    if (previous === undefined) return
    throw new Error(
      `${kind} "${name}" is registered twice: by "${previous}" and again by "${owner}". ` +
        `A server lists one ${kind.toLowerCase()} per name, so rename one of them.`,
    )
  }

  function recordTool(
    owner: string,
    unguarded: string | undefined,
    name: string,
    config: ToolConfigInput,
    callback: unknown,
  ): void {
    claim(toolOwners, "Tool", name, owner)
    if (typeof callback !== "function") {
      throw new TypeError(`Tool "${name}" of "${owner}" has no callback.`)
    }
    const input = strictInput(name, owner, config.inputSchema)
    const view = boundView(name, config._meta)
    const meta = view === undefined ? config._meta : viewToolMeta(config._meta, view, defaults)
    const call = callback as AnyCallback
    tools.push({
      name,
      owner,
      config: {
        ...(config as Omit<RecordedToolConfig, "inputSchema">),
        inputSchema: trimInputSchema(input.schema),
        ...(meta !== undefined && { _meta: meta }),
      },
      handler: input.takesArgs ? (args, ctx) => call(args, ctx) : (_args, ctx) => call(ctx),
      ...(view !== undefined && { view }),
    })
    toolOwners.set(name, owner)
    if (view !== undefined && !views.has(view)) {
      const own = fromWidgetCspMeta(config._meta?.[WIDGET_CSP] as WidgetCspMeta | undefined)
      views.set(view, {
        ...(config.title !== undefined && { description: config.title }),
        csp: defaults ? mergeDomainLists(own, defaults) : own,
      })
    }
    if (unguarded !== undefined && config.annotations?.readOnlyHint !== true) {
      console.warn(openWriteWarning(label, name, unguarded))
    }
  }

  function recordPrompt(
    owner: string,
    name: string,
    config: PromptConfigInput,
    callback: unknown,
  ): void {
    claim(promptOwners, "Prompt", name, owner)
    if (typeof callback !== "function") {
      throw new TypeError(`Prompt "${name}" of "${owner}" has no callback.`)
    }
    prompts.push({ name, owner, config, callback })
    promptOwners.set(name, owner)
  }

  return {
    tools,
    prompts,
    views,
    register(plugin, options = {}) {
      let open = true
      const owner = plugin.name
      // One implementation behind the SDK's overloads: it takes what any of them passes and
      // checks the rest itself, so a plugin registers exactly as on an `McpServer`.
      const server: ModuleServer = {
        registerTool: (name: string, config: ToolConfigInput, callback: unknown) => {
          refuseLate(open, owner, "Tool", name)
          recordTool(owner, options.unguardedModule, name, config, callback)
          // No executor: nothing runs a tool through its handle here.
          return fixedHandle("Tool", name, config) as unknown as RegisteredTool
        },
        registerPrompt: (name: string, config: PromptConfigInput, callback: unknown) => {
          refuseLate(open, owner, "Prompt", name)
          recordPrompt(owner, name, config, callback)
          return fixedHandle("Prompt", name, config) as unknown as RegisteredPrompt
        },
      }
      try {
        plugin.register(server)
      } finally {
        open = false
      }
    },
  }
}
