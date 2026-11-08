/**
 * A `ModuleServer` for a module's own tests: it records each tool and prompt by name and each
 * resource by URI, as the module passed it, and runs its callback the way the SDK does. It
 * validates no args and checks nothing the boot checks (strict input, view bindings, owners,
 * reserved URIs): `createComposedServer` does that.
 */
import type {
  ReadResourceResult,
  RegisteredPrompt,
  RegisteredResource,
  RegisteredResourceTemplate,
  RegisteredTool,
  ResourceMetadata,
  ResourceTemplate,
  ServerContext,
  ToolAnnotations,
} from "@modelcontextprotocol/server"
import type { ModuleServer } from "../module-server.js"

/** What a module passed to `registerTool` or `registerPrompt`. */
export interface RecordedConfig {
  title?: string
  description?: string
  inputSchema?: unknown
  outputSchema?: unknown
  argsSchema?: unknown
  annotations?: ToolAnnotations
  _meta?: Record<string, unknown>
}

/** A tool result in text blocks, the only content Pulse's tools answer with. */
export interface RecordedToolResult {
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

export interface RecordedPromptResult {
  messages: { role: string; content: { type: string; text: string } }[]
}

export interface Registration<TResult> {
  name: string
  config: RecordedConfig
  /** Runs the callback as the SDK does: `(args, ctx)` with a schema, `(ctx)` without. */
  call: (args?: Record<string, unknown>, ctx?: ServerContext) => Promise<TResult>
}

/** What a module passed to `registerResource`, or ext-apps' `registerAppResource` for it. */
export interface RecordedResource {
  name: string
  /** The resource's URI, or a template's URI template. */
  uri: string
  config: ResourceMetadata
  /**
   * Runs the read callback as the SDK does: `(url, ctx)`, a template's `(url, variables, ctx)`.
   * A template's needs the `uri` to read; it throws on one the template does not match.
   */
  read: (uri?: string, ctx?: ServerContext) => Promise<ReadResourceResult>
}

export interface RecordingModuleServer {
  /** Hand it to a plugin's `register(server)` or a registrar. */
  server: ModuleServer
  tools: ReadonlyMap<string, Registration<RecordedToolResult>>
  prompts: ReadonlyMap<string, Registration<RecordedPromptResult>>
  /** Keyed by URI (a template's by its URI template): what a tool's view binding names. */
  resources: ReadonlyMap<string, RecordedResource>
  /** The tool of `name`; throws, naming the registered ones, when there is none. */
  tool(name: string): Registration<RecordedToolResult>
  /** The resource of `uri`; throws, naming the registered ones, when there is none. */
  resource(uri: string): RecordedResource
}

/** A per-call context with what Pulse's handlers read, `mcpReq.signal`; nothing else of the SDK's. */
export function testServerContext(
  signal: AbortSignal = new AbortController().signal,
): ServerContext {
  return { mcpReq: { signal } } as unknown as ServerContext
}

type Callback = (...args: unknown[]) => unknown

function recorder<TResult>(
  into: Map<string, Registration<TResult>>,
  kind: "Tool" | "Prompt",
  schemaKey: "inputSchema" | "argsSchema",
) {
  return (name: string, config: RecordedConfig, callback: unknown) => {
    // As the SDK refuses a second registration of a name.
    if (into.has(name)) throw new Error(`${kind} ${name} is already registered`)
    const run = callback as Callback
    const takesArgs = config[schemaKey] !== undefined
    into.set(name, {
      name,
      config,
      call: async (args = {}, ctx = testServerContext()) =>
        (await (takesArgs ? run(args, ctx) : run(ctx))) as TResult,
    })
    return { ...config, enabled: true }
  }
}

function recordResource(
  into: Map<string, RecordedResource>,
  name: string,
  target: string | ResourceTemplate,
  config: ResourceMetadata,
  callback: unknown,
): RecordedResource {
  const run = callback as Callback
  const uri = typeof target === "string" ? target : target.uriTemplate.toString()
  // As the SDK refuses a second registration of a URI (and of a template's name).
  for (const held of into.values()) {
    if (held.uri === uri || (typeof target !== "string" && held.name === name)) {
      throw new Error(`Resource ${uri} is already registered`)
    }
  }
  const recorded: RecordedResource = {
    name,
    uri,
    config,
    read: async (readUri = uri, ctx = testServerContext()) => {
      if (typeof target === "string") {
        return (await run(new URL(readUri), ctx)) as ReadResourceResult
      }
      const variables = target.uriTemplate.match(readUri)
      if (!variables) throw new Error(`${readUri} does not match the resource template ${uri}.`)
      return (await run(new URL(readUri), variables, ctx)) as ReadResourceResult
    },
  }
  into.set(uri, recorded)
  return recorded
}

export function recordingModuleServer(): RecordingModuleServer {
  const tools = new Map<string, Registration<RecordedToolResult>>()
  const prompts = new Map<string, Registration<RecordedPromptResult>>()
  const resources = new Map<string, RecordedResource>()
  const recordTool = recorder(tools, "Tool", "inputSchema")
  const recordPrompt = recorder(prompts, "Prompt", "argsSchema")
  const server: ModuleServer = {
    registerTool: (name: string, config: RecordedConfig, callback: unknown) =>
      recordTool(name, config, callback) as unknown as RegisteredTool,
    registerPrompt: (name: string, config: RecordedConfig, callback: unknown) =>
      recordPrompt(name, config, callback) as unknown as RegisteredPrompt,
    registerResource: (
      name: string,
      target: string | ResourceTemplate,
      config: ResourceMetadata,
      callback: unknown,
    ) => {
      const { uri } = recordResource(resources, name, target, config, callback)
      return { name, uri, metadata: config, enabled: true } as unknown as RegisteredResource &
        RegisteredResourceTemplate
    },
  }
  return {
    server,
    tools,
    prompts,
    resources,
    tool(name) {
      const registration = tools.get(name)
      if (registration) return registration
      throw new Error(`No tool "${name}"; registered: ${[...tools.keys()].join(", ") || "none"}.`)
    },
    resource(uri) {
      const recorded = resources.get(uri)
      if (recorded) return recorded
      throw new Error(
        `No resource "${uri}"; registered: ${[...resources.keys()].join(", ") || "none"}.`,
      )
    },
  }
}
