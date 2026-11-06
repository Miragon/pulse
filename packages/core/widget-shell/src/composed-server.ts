/**
 * The composed-server boot; a root hands it only its module list and its cross-module wiring.
 * The order is load-bearing: config checks fail before any I/O; OAuth from the env (mcp-use's own
 * `MCP_USE_OAUTH_*`); one `resolveBoot`; the plugins from the active modules;
 * the tool guard before any plugin registers, the views primed once after the last one; metrics
 * before other routes (hono only counts later routes), then the Host/Origin guard, then
 * health (reachable by IP-addressed probes), fonts behind the guard; `listen()` in production only.
 * Under `mcp-use dev` the CLI owns the `Host` check (only it knows its tunnel host), so the guard
 * keeps just the `Origin` half; else `--tunnel` answers every hosted-assistant call 403.
 */
import fs from "node:fs/promises"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { MCPServer, registerViews, type ViewsManifest } from "mcp-use"
import type { OAuthProvider } from "mcp-use/oauth"
import {
  composeModules,
  type ComposableModule,
  type ModuleComposition,
  type ModuleEntry,
  type ResolvedBoot,
  unguardedModules,
} from "./composition.js"
import { installHealthEndpoints } from "./health.js"
import { requestLogLevelWarning, resolvePort, swallowDevCliViewsPrime } from "./host-boot.js"
import {
  describeHttpEdgePolicy,
  edgeRejection,
  HTTP_EDGE_ENV_VARS,
  installHttpEdgeGuard,
  resolveHttpEdgePolicy,
  type HttpEdgePolicy,
} from "./http-edge.js"
import { installMetrics } from "./metrics.js"
import { OAUTH_DEBUG_ENV_VAR, OAUTH_ENV_VARS, oauthFromEnv } from "./oauth-env.js"
import { createBodyLimitedListener, type BodyLimitedListener } from "./node-listener.js"
import { fontAssetsCsp, installFontAssets } from "./font-assets.js"
import { installToolSchemaTrim } from "./tool-schema-trim.js"
import { installMcpRequestContext } from "./request-context.js"
import { installToolRegistration } from "./tool-registration.js"
import { viewPrelude } from "./protocol/view-name.js"

/** What the server reports as `serverInfo` (plus the `instructions` it advertises). */
export interface ComposedServerInfo {
  name: string
  /** Read it from the root's `package.json`; release-please keeps that current. */
  version: string
  title?: string
  description?: string
  websiteUrl?: string
  /** The root's preamble of the server `instructions`; the active modules' snippets follow it. */
  instructions?: string
}

export interface ComposedServerOptions<TShared extends object = object> {
  /** `serverInfo` and the instructions' preamble; `info.name` also prefixes every boot log line. */
  info: ComposedServerInfo
  /** The modules this server composes, in plugin and instruction order. */
  modules: readonly ComposableModule<TShared>[]
  /** Cross-module wiring: what the active modules hand each other. Absent: every plugin gets `{}`. */
  shared?: (entries: readonly ModuleEntry[]) => TShared
  bundle: { jsPath: string; cssPath?: string }
  /** mcp-use reads `MCP_URL` and its own `MCP_USE_*` from `process.env`, so production passes `process.env`. */
  env?: NodeJS.ProcessEnv
  /** Appended to the unknown-variable warning, e.g. where the variables are documented. */
  envVarHint?: string
  /** Installed INSTEAD of the provider the env names (a test's stub IdP). Production omits it. */
  oauth?: OAuthProvider<unknown>
}

export interface ListenOptions {
  /** `0` binds an ephemeral port. */
  port?: number
  host?: string
  /**
   * Drain, then exit 0, on SIGTERM/SIGINT. A root that closes something of its own after the
   * drain (a connection pool) handles the signals itself: `await running.shutdown()`, then its own.
   */
  handleSignals?: boolean
  drainTimeoutMs?: number
  /** Bounds a request's upload (headers and body), not its response; Node's default is 300 s. */
  requestTimeoutMs?: number
}

export interface RunningServer {
  port: number
  url: string
  /**
   * Idempotent drain; refuses new connections at once, so a load balancer that routes until its
   * endpoint update lands (Kubernetes) needs a `preStop` sleep in front.
   */
  shutdown(): Promise<void>
}

export interface ComposedServer {
  /** `mcp-use dev` takes it as the entry's default export. */
  app: MCPServer<unknown>
  boot: ResolvedBoot
  listen(options?: ListenOptions): Promise<RunningServer>
}

/** Below Fly's default 5 s kill timeout and Docker's 10 s stop grace. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 4000

/** Far above any MCP client's upload, far below Node's 300 s default. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

/**
 * What the boot itself reads: the listener's port and bind address (`mcp-use dev` reads them too),
 * the HTTP edge, the OAuth provider variables, the module selection, and two of mcp-use's own: the
 * switch that logs why a bearer token failed verification and the request-log level (the boot
 * warns at debug/trace).
 */
const BOOT_ENV_VARS: readonly string[] = [
  "PORT",
  "HOST",
  ...HTTP_EDGE_ENV_VARS,
  ...OAUTH_ENV_VARS,
  OAUTH_DEBUG_ENV_VAR,
  "MCP_ACTIVE_MODULES",
  "MCP_USE_LOG_LEVEL",
]

const composeFor = <TShared>(
  label: string,
  modules: readonly ComposableModule<TShared>[],
  envVarHint?: string,
): ModuleComposition<TShared> =>
  composeModules<TShared>({ label, modules, appEnvVars: BOOT_ENV_VARS, envVarHint })

/** Every variable a boot over `modules` reads: the boot's own plus each module's `knownEnvVars`. */
export function composedEnvVars<TShared>(
  modules: readonly ComposableModule<TShared>[],
): ReadonlySet<string> {
  return composeFor("env", modules).knownEnvVars
}

/**
 * Every variable the modules retired (`retired.envVars`), which a boot over them refuses while it
 * is set. A neutral test env clears these next to `composedEnvVars`, so a value a shell still
 * exports never reaches the boot.
 */
export function retiredEnvVars<TShared>(
  modules: readonly ComposableModule<TShared>[],
): ReadonlySet<string> {
  return new Set(composeFor("env", modules).retiredEnvVars.keys())
}

const HEALTH_PATH = "/health"
const METRICS_PATH = "/metrics"
const EXEMPT_PATHS = [HEALTH_PATH, METRICS_PATH]

function guardPolicyFor(edge: HttpEdgePolicy, env: NodeJS.ProcessEnv): HttpEdgePolicy {
  return env.MCP_USE_DEV_CLI ? { ...edge, allowedHosts: "*" } : edge
}

/**
 * The resource mcp-use binds every token to (RFC 8707), before it appends the base path: the
 * provider's own, else `MCP_URL`'s origin. Behind our own listener a missing one would only
 * surface on the first `/mcp` call, so the boot fails here instead.
 */
function oauthResource(
  oauth: OAuthProvider<unknown> | undefined,
  env: NodeJS.ProcessEnv,
  label: string,
): string | undefined {
  if (!oauth) return undefined
  if (oauth.resource !== undefined) return String(oauth.resource)
  const mcpUrl = env.MCP_URL?.trim()
  if (!mcpUrl) {
    throw new Error(
      `[${label}] OAuth needs MCP_URL, the server's public origin: tokens must carry <MCP_URL>/mcp in aud (RFC 8707).`,
    )
  }
  // `resolveHttpEdgePolicy` has validated it; mcp-use refuses one with a path under OAuth.
  return new URL(mcpUrl).origin
}

/**
 * The `aud` mcp-use's bearer gate accepts, the `resource` its protected-resource metadata
 * advertises; its JWT verifier also requires `sub`. An IdP set up for another value gets a 401 on
 * every call, so the boot names the value.
 */
function describeOAuthAudience(resource: string, basePath: string): string {
  const audience = new URL(resource)
  audience.pathname = basePath
  return `OAuth: tokens must carry aud ${audience.href} (RFC 8707) and a sub claim.`
}

function serverInstructions(info: ComposedServerInfo, modules?: string): string | undefined {
  const parts = [info.instructions?.trim(), modules]
  const text = parts.filter((part): part is string => Boolean(part)).join("\n\n")
  return text || undefined
}

function createServer(
  info: ComposedServerInfo,
  instructions: string | undefined,
  oauth: OAuthProvider<unknown> | undefined,
): MCPServer<unknown> {
  // No `baseUrl`: mcp-use resolves the serving origin from the request or `MCP_URL`.
  const config = {
    ...(info.title ? { title: info.title } : {}),
    ...(info.websiteUrl ? { websiteUrl: info.websiteUrl } : {}),
    ...(instructions ? { instructions } : {}),
    name: info.name,
    version: info.version,
    description: info.description,
    host: "localhost",
  }
  return oauth ? new MCPServer<unknown>({ ...config, oauth }) : new MCPServer<never>(config)
}

/** A missing file only warns, so a dev server boots before the first bundle build. */
async function readBundleFile(filePath: string, label: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8")
  } catch {
    console.warn(
      `[${label}] No widget bundle at ${filePath}: views render empty until the bundle is built and the server restarts.`,
    )
    return ""
  }
}

/** Priming is one-shot in mcp-use, so it runs once every plugin bound its views: all share ONE bundle, each behind its name's prelude. */
async function primeViews(
  server: MCPServer,
  viewNames: ReadonlySet<string>,
  bundle: ComposedServerOptions["bundle"],
  label: string,
): Promise<void> {
  if (viewNames.size === 0) return
  const js = await readBundleFile(bundle.jsPath, label)
  const css = bundle.cssPath ? await readBundleFile(bundle.cssPath, label) : ""
  // The prelude names the view before the bundle runs (`mountViews` reads it).
  const manifest: ViewsManifest = Object.fromEntries(
    [...viewNames].map((name) => [name, { kind: "inline", js: viewPrelude(name) + js, css }]),
  )
  server[registerViews](manifest)
}

/** The one selection of this boot, with everything it logs: config checks fail before any I/O. */
function resolveSelection<TShared extends object>(
  options: ComposedServerOptions<TShared>,
  composition: ModuleComposition<TShared>,
  env: NodeJS.ProcessEnv,
) {
  const label = options.info.name
  // A renamed setting first: an operator upgrading with old settings reads the rename, not a
  // later check's failure.
  composition.refuseRetired(env)
  composition.warnUnknownEnvVars(env)
  const edge = resolveHttpEdgePolicy(env)
  const oauth = options.oauth ?? oauthFromEnv(env, label)
  const resource = oauthResource(oauth, env, label)
  // The same test `createServer` installs OAuth on: a boot is authenticated only with the bearer gate.
  const boot = composition.resolveBoot(env, { authenticated: Boolean(oauth) })
  composition.emitBootWarnings(env)
  const logLevel = requestLogLevelWarning(env)
  if (logLevel) console.warn(`[${label}] ${logLevel}`)
  composition.logEffectiveToolsets(boot)
  console.info(`[${label}] ${describeHttpEdgePolicy(edge)}`)
  return { edge, oauth, resource, boot }
}

async function buildServer<TShared extends object>(
  options: ComposedServerOptions<TShared>,
  composition: ModuleComposition<TShared>,
  selection: ReturnType<typeof resolveSelection>,
  env: NodeJS.ProcessEnv,
): Promise<MCPServer<unknown>> {
  const { info } = options
  const { boot, oauth } = selection
  const app = createServer(info, serverInstructions(info, composition.instructions(boot)), oauth)
  // Registrars take the OAuth-less type: no handler reads `ctx.auth`, only the request middleware.
  const server = app as unknown as MCPServer
  const registration = installToolRegistration(server, fontAssetsCsp(env), info.name)
  const shared = options.shared?.(boot.entries) ?? ({} as TShared)
  // Keyed by the entry, not the plugin's name: the warning names the module MCP_ACTIVE_MODULES lists.
  const unguarded = unguardedModules(boot)
  for (const entry of boot.entries) {
    const unguardedModule = unguarded.has(entry.app) ? entry.app : undefined
    for (const plugin of composition.pluginsFor([entry], shared)) {
      registration.register(plugin, { unguardedModule })
    }
  }
  await primeViews(server, registration.viewNames, options.bundle, info.name)
  return app
}

const displayHost = (host: string): string => {
  if (host === "0.0.0.0" || host === "::") return "localhost"
  return host.includes(":") ? `[${host}]` : host
}

async function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([promise.then(() => true as const), timeout])
  } finally {
    clearTimeout(timer)
  }
}

interface DrainContext {
  label: string
  app: MCPServer<unknown>
  server: http.Server
  listener: BodyLimitedListener
  state: { draining: boolean }
  drainTimeoutMs: number
}

async function drain(ctx: DrainContext): Promise<void> {
  const { label, app, server, listener } = ctx
  ctx.state.draining = true
  console.info(`[${label}] Draining: ${listener.inFlight} request(s) in flight`)
  const closed = new Promise<void>((resolve) => server.close(() => resolve()))
  server.closeIdleConnections()
  if (!(await settlesWithin(listener.idle(), ctx.drainTimeoutMs))) {
    console.warn(
      `[${label}] Drain timed out after ${ctx.drainTimeoutMs}ms: closing ${listener.inFlight} request(s)`,
    )
  }
  // Closing the MCP handler before the sockets ends streams cleanly instead of resetting them.
  await app.close().catch((error: unknown) => console.error(`[${label}] close failed:`, error))
  server.closeAllConnections()
  await closed
}

/** The drain never rejects: a failing `app.close()` only logs, so the process exits 0 after it. */
function installSignalHandlers(shutdown: () => Promise<void>): void {
  // `once`: a second signal during the drain kills the process the default way.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void shutdown().then(() => process.exit(0)))
  }
}

async function listen(
  ctx: Omit<DrainContext, "server" | "listener" | "drainTimeoutMs"> & {
    guard: HttpEdgePolicy
    env: NodeJS.ProcessEnv
  },
  options: ListenOptions,
): Promise<RunningServer> {
  const { label, app, guard, env } = ctx
  const host = options.host ?? (env.HOST?.trim() || "0.0.0.0")
  const port = options.port ?? resolvePort({ env, label })
  const listener = createBodyLimitedListener(app, {
    maxBodyBytes: guard.maxBodyBytes,
    maxInFlightBodyBytes: guard.maxInFlightBodyBytes,
    // The guard refuses these whatever their body says: never buffer it.
    refusedBeforeBody: (req) =>
      edgeRejection(
        {
          method: (req.method ?? "GET").toUpperCase(),
          path: (req.url ?? "/").split("?")[0],
          host: req.headers.host,
          origin: req.headers.origin,
        },
        guard,
        EXEMPT_PATHS,
      ) !== undefined,
    onError: (error) => console.error(`[${label}] request failed:`, error),
  })
  const requestTimeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const server = http.createServer(
    {
      requestTimeout,
      headersTimeout: requestTimeout,
      connectionsCheckingInterval: Math.min(requestTimeout, 5000),
    },
    listener,
  )
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, () => {
      server.off("error", reject)
      resolve()
    })
  })
  const bound = (server.address() as AddressInfo).port
  const url = `http://${displayHost(host)}:${bound}${app.basePath}`
  console.info(`[${label}] Listening on ${url}`)

  let draining: Promise<void> | undefined
  const shutdown = (): Promise<void> =>
    (draining ??= drain({
      ...ctx,
      server,
      listener,
      drainTimeoutMs: options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS,
    }))
  if (options.handleSignals) installSignalHandlers(shutdown)
  return { port: bound, url, shutdown }
}

async function boot<TShared extends object>(
  options: ComposedServerOptions<TShared>,
  composition: ModuleComposition<TShared>,
  env: NodeJS.ProcessEnv,
): Promise<ComposedServer> {
  const label = options.info.name
  const selection = resolveSelection(options, composition, env)
  const { edge, boot } = selection
  const guard = guardPolicyFor(edge, env)
  if (guard !== edge) {
    console.info(
      `[${label}] mcp-use dev: the CLI checks Host (localhost-class + its tunnel); Origin is checked here.`,
    )
  }

  const app = await buildServer(options, composition, selection, env)
  // After mcp-use built its server: it has accepted the resource and knows the base path.
  if (selection.resource) {
    console.info(`[${label}] ${describeOAuthAudience(selection.resource, app.basePath)}`)
  }
  const state = { draining: false }

  // Request logging is mcp-use's own (`MCP_USE_LOG_LEVEL`).
  installMcpRequestContext(app)
  installToolSchemaTrim(app)
  swallowDevCliViewsPrime(app, env)
  installMetrics(app, { path: METRICS_PATH, token: edge.metricsToken })
  installHttpEdgeGuard(app, guard, { exemptPaths: EXEMPT_PATHS })
  installHealthEndpoints(app, { path: HEALTH_PATH, label, draining: () => state.draining })
  // Behind the guard: a font GET passes the Origin half, a foreign Host does not.
  installFontAssets(app, { label })

  return {
    app,
    boot,
    listen: (listenOptions = {}) => listen({ label, app, guard, env, state }, listenOptions),
  }
}

/**
 * Composes the modules, installs OAuth from the env and builds the plugins. Returns BEFORE
 * listening: `mcp-use dev` serves `app` itself, production calls `listen()`.
 */
export async function createComposedServer<TShared extends object>(
  options: ComposedServerOptions<TShared>,
): Promise<ComposedServer> {
  const { info, env = process.env } = options
  // mcp-use telemetry is on by default; an ops server must not phone home unless opted in.
  process.env.MCP_USE_ANONYMIZED_TELEMETRY ??= "false"
  const composition = composeFor(info.name, options.modules, options.envVarHint)
  return boot(options, composition, env)
}
