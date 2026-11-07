/**
 * The boot's record of what the modules register. Each plugin's `register(server)` gets a
 * `ModuleServer`, the official SDK server's three registration methods, and the boot records every
 * call ONCE, checked: a name or resource URI two registrations share fails the boot naming both
 * owners; a tool's input is strict (CLAUDE.md invariant 5) and its advertised schema trimmed; a
 * view-bound tool binds the bundle's view named after it, which gets the server-wide view CSP, or
 * a resource a module registered, whose CSP stays the module's; a resource's or prompt's callback
 * is guarded (`module-callbacks.ts`). `McpHttpApp` replays the record into a fresh `McpServer` per
 * request, so nothing can change it once the boot is done.
 */
import {
  McpServer,
  type CallToolResult,
  type InputRequiredResult,
  type RegisteredPrompt,
  type RegisteredResource,
  type RegisteredResourceTemplate,
  type RegisteredTool,
  type ResourceTemplate,
  type ServerContext,
  type StandardSchemaWithJSON,
  type ToolAnnotations,
} from "@modelcontextprotocol/server"
import type { z } from "zod"
import type { ModulePlugin } from "./composition.js"
import { guardedCallback, holdsArray } from "./module-callbacks.js"
import type { ModuleServer } from "./module-server.js"
import {
  recordedResource,
  resourceTargetOf,
  servesUri,
  type RecordedResource,
  type ResourceConfig,
} from "./resource-registration.js"
import { trimInputSchema } from "./tool-schema-trim.js"
import {
  fromWidgetCspMeta,
  hasDomains,
  mergeDomainLists,
  toWidgetCspMeta,
  type AppResourceCsp,
  type WidgetCspMeta,
} from "./view-csp.js"
import type { ViewBinding } from "./view-resource.js"
import { strictToolInput, VIEW_RESOURCE_URI_PREFIX, viewNameOf } from "./widget-tool-bindings.js"

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
  /** The resource it binds: its view, stamped on each of its results. */
  resourceUri?: string
  /** Set when that resource is the bundle's view named after it, `ui://views/<view>.html`. */
  view?: string
}

export interface RecordedPrompt {
  name: string
  owner: string
  /** As registered; the SDK reads `argsSchema` and calls `callback` with or without args by it. */
  config: PromptConfigInput
  callback: unknown
}

/** What the boot serves: every module's tools, prompts and resources, and each bundle view once. */
export interface ModuleRegistrations {
  readonly tools: readonly RecordedTool[]
  readonly prompts: readonly RecordedPrompt[]
  readonly resources: readonly RecordedResource[]
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
  /**
   * After the last plugin: every tool binds a resource this server serves. Only now, since
   * ext-apps' docs register a tool before the resource it binds.
   */
  checkBindings(): void
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

type AnyCallback = (...args: unknown[]) => ToolResult | Promise<ToolResult>

/** Feeds never carry it, so it marks the tools Apps SDK hosts render. */
const OUTPUT_TEMPLATE = "openai/outputTemplate"
const WIDGET_CSP = "openai/widgetCSP"
const FLAT_RESOURCE_URI = "ui/resourceUri"
const JSON_SCHEMA_TARGET = "draft-2020-12"

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

/** The boot's answer to a resource no tool could reach, with both ways out. */
function unservedBinding(tool: string, owner: string, uri: unknown): Error {
  return new Error(
    `Tool "${tool}" of "${owner}" binds ${JSON.stringify(uri)}, which this server does not serve: ` +
      "bind the view named after the tool, ui://views/<tool>.html, which the boot serves from the " +
      "bundle (showToolBinding(name, title)), or a resource a module registers " +
      "(registerAppResource, showToolBinding(name, title, { resourceUri })).",
  )
}

interface ToolBinding {
  uri: string
  /** The bundle's view of that name, when `uri` is one. */
  view?: string
}

/** What a host renders: ext-apps refuses anything but `ui://`, and a template names no document. */
const isViewUri = (uri: unknown): uri is string =>
  typeof uri === "string" && uri.startsWith("ui://") && !/[{}]/.test(uri)

/**
 * The resource a tool binds, from whichever spelling states it: MCP Apps' `_meta.ui.resourceUri`,
 * the flat key older hosts read, the Apps SDK's template. Two that differ would show one view on
 * one host and another on the next. Under `ui://views/` a tool binds only the view of its own
 * name: a view re-runs that tool on a stripped result, whichever tool opened it.
 */
function bindingOf(
  tool: string,
  owner: string,
  meta: Record<string, unknown> | undefined,
): ToolBinding | undefined {
  const ui = meta?.ui
  if (ui !== undefined && !isRecord(ui)) {
    throw new TypeError(
      `Tool "${tool}" of "${owner}" states _meta.ui as ${JSON.stringify(ui)}, which is no object: ` +
        "spread showToolBinding(name, title) instead of writing it.",
    )
  }
  const template = meta?.[OUTPUT_TEMPLATE]
  const uri = [ui?.resourceUri, meta?.[FLAT_RESOURCE_URI], template].find(
    (stated) => stated !== undefined,
  )
  if (uri === undefined) return undefined
  if (!isViewUri(uri)) {
    throw new Error(
      `Tool "${tool}" of "${owner}" binds ${JSON.stringify(uri)}, which no host would render: a ` +
        "view's URI starts with ui:// and names one document, no template. Register the document " +
        `as a resource of your own, like ui://${owner}/<view>.html.`,
    )
  }
  if (template !== undefined && template !== uri) {
    throw new Error(
      `Tool "${tool}" of "${owner}" binds ${uri}, but its openai/outputTemplate names ` +
        `${JSON.stringify(template)}: state both with showToolBinding(name, title, { resourceUri }).`,
    )
  }
  if (!uri.startsWith(VIEW_RESOURCE_URI_PREFIX)) return { uri }
  if (viewNameOf(uri) !== tool) throw unservedBinding(tool, owner, uri)
  return { uri, view: tool }
}

/**
 * A view-bound tool's `_meta`: both spellings of its view (as `registerAppTool` writes them) and,
 * for Apps SDK hosts, `defaults` merged into its own `openai/widgetCSP`. Copied, never mutated:
 * `showToolBinding` and `appOnly` parts are shared.
 */
function boundToolMeta(
  meta: Record<string, unknown> | undefined,
  resourceUri: string,
  defaults: AppResourceCsp | undefined,
): Record<string, unknown> {
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

type RegistrationKind = "Tool" | "Prompt" | "Resource"

/**
 * The handle `registerTool`/`registerPrompt`/`registerResource` return. Every request gets its own
 * `McpServer` from the record, so a handle could change nothing a client sees: it refuses instead
 * of pretending.
 */
function fixedHandle(kind: RegistrationKind, name: string, config: object) {
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

function refuseLate(open: boolean, owner: string, kind: RegistrationKind, name: string): void {
  if (open) return
  throw new Error(
    `${kind} "${name}" registers after "${owner}" returned from register(server): the boot ` +
      "records every registration once, so register it inside register(server).",
  )
}

/** V8's sentence for calling what is no function; group 1 is the name called, if it states one. */
const NOT_A_FUNCTION = /(?:(?:^|\.)([\w$]+))? is not a function$/

/**
 * The names a call on the server may have meant: those of the SDK's `McpServer` and its former
 * `tool`, `prompt` and `resource`. Any other name is as likely another object's as the server's.
 */
const SERVER_NAMES: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(McpServer.prototype),
  "tool",
  "prompt",
  "resource",
])

/** What the server offers, said only where the name called is one a server has or had. */
function aboutTheServer(method: string | undefined, server: ModuleServer): string {
  if (method === undefined || !SERVER_NAMES.has(method)) return ""
  const offers = Object.hasOwn(server, method) ? "offers" : `has no ${method}(): it offers`
  return ` Its server, a ModuleServer, ${offers} registerTool, registerPrompt and registerResource.`
}

/**
 * A call the `ModuleServer` does not offer, `server.tool(...)` above all, fails with a sentence that
 * names no module and, once minified, reads `B.tool is not a function`. That sentence cannot tell
 * the server from another object of the module, so the answer names the module and speaks of the
 * server only for a name a server has or had, and then only of what holds either way. Every other
 * error comes back as it is.
 */
function namingTheModule(error: unknown, owner: string, server: ModuleServer): unknown {
  if (!(error instanceof TypeError)) return error
  const call = NOT_A_FUNCTION.exec(error.message)
  if (!call) return error
  const named = new TypeError(
    `Module "${owner}" failed in register(server): ${error.message}.` +
      aboutTheServer(call[1], server),
    { cause: error },
  )
  // The frames of the call, which the boot prints below its line, not those of this catch.
  named.stack = error.stack?.replace(error.message, () => named.message)
  return named
}

/**
 * The boot's one registry: `label` prefixes the open-write warning, `csp` is the server-wide view
 * CSP (the served fonts' origin), which every bundle view and, in Apps SDK spelling, its tool get
 * on top of what the tool states itself. A view a module registers loads its own fonts: nothing
 * of it is touched.
 */
export function createModuleRegistry(
  csp: AppResourceCsp | undefined,
  label: string,
): ModuleRegistry {
  const tools: RecordedTool[] = []
  const prompts: RecordedPrompt[] = []
  const resources: RecordedResource[] = []
  const views = new Map<string, ViewBinding>()
  const toolOwners = new Map<string, string>()
  const promptOwners = new Map<string, string>()
  /** Every resource name a client lists, a bundle view's among them: it carries its tool's name. */
  const resourceOwners = new Map<string, string>()
  const uriOwners = new Map<string, string>()
  const defaults = hasDomains(csp) ? csp : undefined

  function claim(owners: Map<string, string>, kind: string, name: string, owner: string): void {
    const previous = owners.get(name)
    if (previous === undefined) return
    throw new Error(
      `${kind} "${name}" is registered twice: by "${previous}" and again by "${owner}". ` +
        `A server lists one ${kind.toLowerCase()} per name, so rename one of them.`,
    )
  }

  /** The bundle's view of a tool: named after it, titled by it, with the server-wide CSP. */
  function addBundleView(view: string, owner: string, config: ToolConfigInput): void {
    resourceOwners.set(view, owner)
    const own = fromWidgetCspMeta(config._meta?.[WIDGET_CSP] as WidgetCspMeta | undefined)
    views.set(view, {
      ...(config.title !== undefined && { description: config.title }),
      csp: defaults ? mergeDomainLists(own, defaults) : own,
    })
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
    const binding = bindingOf(name, owner, config._meta)
    const view = binding?.view
    if (view !== undefined) claim(resourceOwners, "Resource", view, owner)
    const meta =
      binding && boundToolMeta(config._meta, binding.uri, view === undefined ? undefined : defaults)
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
      ...(binding && { resourceUri: binding.uri }),
      ...(view !== undefined && { view }),
    })
    toolOwners.set(name, owner)
    if (view !== undefined) addBundleView(view, owner, config)
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
    const guarded = guardedCallback(
      `Prompt "${name}" of "${owner}"`,
      callback as AnyCallback,
      holdsArray("messages"),
    )
    prompts.push({ name, owner, config, callback: guarded })
    promptOwners.set(name, owner)
  }

  function recordResource(
    owner: string,
    name: string,
    target: string | ResourceTemplate,
    config: ResourceConfig,
    callback: unknown,
  ): void {
    const { uri, template } = resourceTargetOf(name, owner, target)
    claim(resourceOwners, "Resource", name, owner)
    const previous = uriOwners.get(uri)
    if (previous !== undefined) {
      throw new Error(
        `Resource URI "${uri}" is registered twice: by "${previous}" and again by "${owner}". ` +
          "A server serves one resource per URI, so change one of them.",
      )
    }
    if (typeof callback !== "function") {
      throw new TypeError(`Resource "${name}" of "${owner}" has no read callback.`)
    }
    resources.push(recordedResource({ name, owner, uri, config }, template, callback))
    resourceOwners.set(name, owner)
    uriOwners.set(uri, owner)
  }

  return {
    tools,
    prompts,
    resources,
    views,
    checkBindings() {
      for (const { name, owner, resourceUri, view } of tools) {
        if (resourceUri === undefined || view !== undefined) continue
        if (!servesUri(resources, resourceUri)) throw unservedBinding(name, owner, resourceUri)
      }
    },
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
        registerResource: (
          name: string,
          target: string | ResourceTemplate,
          config: ResourceConfig,
          callback: unknown,
        ) => {
          refuseLate(open, owner, "Resource", name)
          recordResource(owner, name, target, config, callback)
          const handle = fixedHandle("Resource", name, { name, metadata: config })
          return handle as unknown as RegisteredResource & RegisteredResourceTemplate
        },
      }
      try {
        plugin.register(server)
      } catch (error) {
        throw namingTheModule(error, owner, server)
      } finally {
        open = false
      }
    },
  }
}
