/**
 * A `ModuleServer` for a module's own tests: it records each tool and prompt by name, as the module
 * passed it, and runs its callback the way the SDK does. It validates no args and checks nothing
 * the boot checks (strict input, view bindings, owners): `createComposedServer` does that.
 */
import type {
  RegisteredPrompt,
  RegisteredTool,
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

export interface RecordingModuleServer {
  /** Hand it to a plugin's `register(server)` or a registrar. */
  server: ModuleServer
  tools: ReadonlyMap<string, Registration<RecordedToolResult>>
  prompts: ReadonlyMap<string, Registration<RecordedPromptResult>>
  /** The tool of `name`; throws, naming the registered ones, when there is none. */
  tool(name: string): Registration<RecordedToolResult>
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

export function recordingModuleServer(): RecordingModuleServer {
  const tools = new Map<string, Registration<RecordedToolResult>>()
  const prompts = new Map<string, Registration<RecordedPromptResult>>()
  const recordTool = recorder(tools, "Tool", "inputSchema")
  const recordPrompt = recorder(prompts, "Prompt", "argsSchema")
  const server: ModuleServer = {
    registerTool: (name: string, config: RecordedConfig, callback: unknown) =>
      recordTool(name, config, callback) as unknown as RegisteredTool,
    registerPrompt: (name: string, config: RecordedConfig, callback: unknown) =>
      recordPrompt(name, config, callback) as unknown as RegisteredPrompt,
  }
  return {
    server,
    tools,
    prompts,
    tool(name) {
      const registration = tools.get(name)
      if (registration) return registration
      throw new Error(`No tool "${name}"; registered: ${[...tools.keys()].join(", ") || "none"}.`)
    },
  }
}
