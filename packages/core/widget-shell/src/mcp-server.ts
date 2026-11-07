/**
 * The HTTP app the boot serves, on the official SDK: one `McpServer` per request behind
 * `createMcpHandler`, into which the modules' recorded registrations replay (`tool-registration.ts`),
 * together with one resource per bundle view. `use`/`get` are one Hono app in registration order,
 * `/mcp` mounted last.
 */
import {
  createMcpHandler,
  McpServer,
  oauthMetadataResponse,
  type CallToolResult,
  type McpHttpHandler,
  type PromptCallback,
  type ServerContext,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server"
import { Hono, type Context } from "hono"
import {
  isNormalTarget,
  jsonRpcErrorResponse,
  NOT_NORMAL_TARGET,
  type RefusedRequest,
} from "./http-edge.js"
import {
  oauthDiscovery,
  oauthGate,
  resolveOAuthResource,
  toolResultChallenge,
} from "./oauth-gate.js"
import type { OAuthProvider } from "./oauth-providers.js"
import { installRequestLog, logRefusedRequest, requestLogLevel } from "./request-log.js"
import { replayResource } from "./resource-registration.js"
import type { ModuleRegistrations, RecordedPrompt, RecordedTool } from "./tool-registration.js"
import {
  viewDocument,
  viewResourceConfig,
  viewResultMeta,
  type ViewBinding,
  type ViewBundle,
} from "./view-resource.js"

export type { ToolAnnotations } from "@modelcontextprotocol/server"
export type { OAuthProvider } from "./oauth-providers.js"
export type { ViewBundle, ViewsManifest } from "./view-resource.js"

export interface McpHttpAppConfig {
  name: string
  version: string
  title?: string
  description?: string
  websiteUrl?: string
  instructions?: string
  /** What the modules registered; replayed into every request's `McpServer`. */
  registrations: ModuleRegistrations
  oauth?: OAuthProvider
  /** `MCP_URL`, the public origin (else each request's own), and `MCP_LOG_LEVEL`. */
  env?: NodeJS.ProcessEnv
  maxRequestBodySize?: number
  /** Prefixes the request log; `false` silences it. */
  log?: boolean
}

type HttpMiddleware = (ctx: Context, next: () => Promise<void>) => Promise<Response | void>
type HttpHandler = (ctx: Context) => Response | Promise<Response>
type RequestMiddleware = (ctx: unknown, next: () => Promise<void>) => Promise<void>
type ToolCallMiddleware = (ctx: unknown, next: () => Promise<unknown>) => Promise<unknown>
type RefusalHook = (refused: RefusedRequest) => void

const BASE_PATH = "/mcp"
/**
 * What the server does, nothing more: the lists never change at runtime, so no `list_changed`
 * is ever sent, and `resources/subscribe` has no handler (`-32601`), so `subscribe` is not
 * announced. `logging/setLevel` answers (the SDK's handler); no module logs through it.
 */
export const CAPABILITIES = {
  logging: {},
  tools: { listChanged: true },
  prompts: { listChanged: true },
  resources: { listChanged: true },
}

export class McpHttpApp {
  readonly basePath = BASE_PATH
  readonly #config: McpHttpAppConfig
  /**
   * Routes on the path as sent, never percent-decoded (Hono's default): `/%6Dcp` is no alias of
   * `/mcp` a gateway's path rule would miss. Dot segments never get here: the listener refuses
   * them on the raw target (`isNormalTarget`).
   */
  readonly #http = new Hono({ getPath: (request) => new URL(request.url).pathname })
  readonly #requestHooks: RequestMiddleware[] = []
  readonly #toolCallHooks: ToolCallMiddleware[] = []
  readonly #refusalHooks: RefusalHook[] = []
  readonly #oauth: { resource: URL; discovery: ReturnType<typeof oauthDiscovery> } | undefined
  #bundles: Record<string, ViewBundle> = {}
  #handler: McpHttpHandler | undefined

  constructor(config: McpHttpAppConfig) {
    this.#config = config
    if (config.oauth) {
      const resource = resolveOAuthResource(config.oauth, config.env?.MCP_URL, BASE_PATH)
      // Validated now: an issuer discovery cannot advertise fails the boot, not each request.
      this.#oauth = { resource, discovery: oauthDiscovery(config.oauth, resource) }
    }
    if (config.log !== false) {
      installRequestLog(this.#http, BASE_PATH, requestLogLevel(config.env ?? process.env))
      this.onRefused(logRefusedRequest)
    }
  }

  /** `mcp:*` runs around every MCP request, `mcp:tools/call` around a handler, `*` is HTTP. */
  use(pattern: "mcp:*", fn: RequestMiddleware): this
  use(pattern: "mcp:tools/call", fn: ToolCallMiddleware): this
  use(pattern: "*", fn: HttpMiddleware): this
  use(pattern: string, fn: never): this {
    if (pattern === "mcp:*") this.#requestHooks.push(fn)
    else if (pattern === "mcp:tools/call") this.#toolCallHooks.push(fn)
    else this.#http.use(pattern, fn)
    return this
  }

  /** Runs for a request answered in front of the routes, which no `*` middleware sees. */
  onRefused(fn: RefusalHook): this {
    this.#refusalHooks.push(fn)
    return this
  }

  /** The listener's report of a request it answered itself. */
  recordRefused = (refused: RefusedRequest): void => {
    for (const hook of this.#refusalHooks) hook(refused)
  }

  get(path: string, handler: HttpHandler): this {
    this.#http.get(path, handler)
    return this
  }

  post(path: string, handler: HttpHandler): this {
    this.#http.post(path, handler)
    return this
  }

  primeViews(bundles: Record<string, ViewBundle>): void {
    this.#bundles = { ...this.#bundles, ...bundles }
  }

  /**
   * Builds one request's server from the record, once, without a request: what the SDK itself
   * refuses at registration (a resource's invalid cache hint) then fails the boot, not every
   * request of every module.
   */
  checkReplay(): void {
    this.#buildSdkServer(undefined)
  }

  /**
   * A `Request`'s URL has already been parsed, so its dot segments are gone and only the listener
   * can refuse those; what the parser leaves (`//mcp`, `/mcp/`) is refused here the same way.
   */
  fetch = async (request: Request): Promise<Response> => {
    this.#mount()
    const { pathname } = new URL(request.url)
    if (isNormalTarget(pathname)) return this.#http.fetch(request)
    const { method } = request
    this.recordRefused({ method, target: pathname, status: 404, message: NOT_NORMAL_TARGET })
    return jsonRpcErrorResponse(404, NOT_NORMAL_TARGET)
  }

  async close(): Promise<void> {
    await this.#handler?.close()
  }

  /** Lazily, so every `use` of the boot sits in front of `/mcp`. */
  #mount(): void {
    if (this.#handler) return
    const handler = createMcpHandler(({ requestInfo }) => this.#buildSdkServer(requestInfo), {
      ...(this.#config.maxRequestBodySize !== undefined && {
        maxRequestBodySize: this.#config.maxRequestBodySize,
      }),
    })
    this.#handler = handler
    const { oauth } = this.#config
    const gate =
      oauth && this.#oauth
        ? oauthGate(oauth, this.#oauth.resource, (error) =>
            console.error(`[${this.#config.name}] token verification failed:`, error),
          )
        : undefined
    if (this.#oauth) {
      const { discovery } = this.#oauth
      // Every method: a preflight gets the SDK's CORS answer, a POST its 405.
      this.#http.all(
        "/.well-known/*",
        (c) => oauthMetadataResponse(c.req.raw, discovery) ?? c.notFound(),
      )
    }
    this.#http.all(BASE_PATH, async (c) => {
      const authInfo = gate ? await gate(c.req.raw) : undefined
      if (authInfo instanceof Response) {
        return (await toolResultChallenge(c.req.raw, authInfo)) ?? authInfo
      }
      let response: Response | undefined
      const run = async (): Promise<void> => {
        response = await handler.fetch(c.req.raw, authInfo ? { authInfo } : undefined)
      }
      // Under OAuth the hooks read the credential the gate verified, never the raw header: what
      // passthrough auth forwards and the per-caller caches key on is exactly what it checked.
      const verified = authInfo && `Bearer ${authInfo.token}`
      const hookCtx = {
        request: {
          header: (name: string) =>
            verified && name.toLowerCase() === "authorization" ? verified : c.req.header(name),
        },
        ...(authInfo && { auth: authInfo }),
      }
      const chain = this.#requestHooks.reduceRight<() => Promise<void>>(
        (next, hook) => () => hook(hookCtx, next),
        run,
      )
      await chain()
      return response
    })
  }

  #buildSdkServer(request: Request | undefined): McpServer {
    const { name, version, title, description, websiteUrl, instructions } = this.#config
    const server = new McpServer(
      {
        name,
        version,
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(websiteUrl !== undefined && { websiteUrl }),
      },
      { capabilities: CAPABILITIES, ...(instructions !== undefined && { instructions }) },
    )
    const { tools, prompts, resources, views } = this.#config.registrations
    for (const tool of tools) this.#registerTool(server, tool)
    for (const prompt of prompts) registerPrompt(server, prompt)
    for (const [viewName, binding] of views) {
      if (this.#bundles[viewName]) this.#registerView(server, viewName, binding, request)
    }
    for (const resource of resources) replayResource(server, resource)
    return server
  }

  /** Around the recorded handler: the `mcp:tools/call` middleware, then a view tool's result stamps. */
  #registerTool(server: McpServer, tool: RecordedTool): void {
    const resultMeta = tool.resourceUri === undefined ? undefined : viewResultMeta(tool.resourceUri)
    const invoke = async (args: unknown, ctx: ServerContext) => {
      const inner = async (): Promise<unknown> => {
        const result = await tool.handler(args, ctx)
        if (!resultMeta || (result as CallToolResult).isError === true) return result
        return { ...result, _meta: { ...result._meta, ...resultMeta } }
      }
      const hookCtx = { params: { name: tool.name, arguments: args } }
      const chain = this.#toolCallHooks.reduceRight<() => Promise<unknown>>(
        (next, hook) => () => hook(hookCtx, next),
        inner,
      )
      return (await chain()) as CallToolResult
    }
    server.registerTool(tool.name, tool.config, invoke)
  }

  #registerView(
    server: McpServer,
    viewName: string,
    binding: ViewBinding,
    request: Request | undefined,
  ): void {
    const bundle = this.#bundles[viewName]
    const env = this.#config.env ?? process.env
    const { uri, mimeType, config, readMeta, publicBase } = viewResourceConfig(
      viewName,
      binding,
      env,
    )
    server.registerResource(
      viewName,
      uri,
      { ...config, _meta: readMeta(request) },
      (readUri, ctx) => {
        const req = ctx.http?.req ?? request
        return {
          contents: [
            {
              uri: readUri.href,
              mimeType,
              text: viewDocument(bundle, publicBase(req)),
              _meta: readMeta(req),
            },
          ],
        }
      },
    )
  }
}

/** As recorded: the SDK calls the callback with or without args, by its `argsSchema`. */
function registerPrompt(server: McpServer, { name, config, callback }: RecordedPrompt): void {
  server.registerPrompt(
    name,
    config as typeof config & { argsSchema?: StandardSchemaWithJSON },
    callback as PromptCallback<StandardSchemaWithJSON>,
  )
}
