/**
 * The composed-server boot sequence; roots keep only their module list, OAuth provider and runtime.
 * The order is load-bearing: config checks fail before any I/O; one `resolveBoot`; `setup(boot)`;
 * metrics before other routes (hono only counts later routes), then the Host/Origin guard, then
 * health (reachable by IP-addressed probes), fonts behind the guard; `listen()` in production only.
 * Under `mcp-use dev` the CLI owns the `Host` check (only it knows its tunnel host), so the guard
 * keeps just the `Origin` half; else `--tunnel` answers every hosted-assistant call 403.
 */
import http from "node:http"
import type { AddressInfo } from "node:net"
import type { AppPlugin } from "@miragon/mcp-toolkit-core"
import { createFrameworkApp, type DashboardStore } from "@miragon/mcp-toolkit-core/tools"
import type { MCPServer } from "mcp-use"
import type { OAuthProvider } from "mcp-use/oauth"
import { frameworkWritesAllowed, type ModuleComposition, type ResolvedBoot } from "./composition.js"
import { installHealthEndpoints, type ReadinessCheck } from "./health.js"
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
import { createBodyLimitedListener, type BodyLimitedListener } from "./node-listener.js"
import { fontAssetsCsp, installFontAssets } from "./font-assets.js"
import { installToolSchemaTrim } from "./tool-schema-trim.js"
import { installMcpRequestContext } from "./request-context.js"
import { honorWidgetMetaDefaults } from "./widget-meta-defaults.js"

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

export interface ComposedServerRuntime {
  plugins: AppPlugin<MCPServer>[]
  /** `undefined` = the toolkit's in-memory dashboard store. */
  dashboardStore?: DashboardStore
  /** The server's OWN dependencies only, never engines or Prometheus. */
  readiness?: Record<string, ReadinessCheck>
  /** Runs after HTTP has drained. */
  shutdown?: () => Promise<void>
}

export type BootComposition = Pick<
  ModuleComposition<never>,
  | "warnUnknownEnvVars"
  | "resolveBoot"
  | "emitBootWarnings"
  | "logEffectiveToolsets"
  | "instructions"
>

export interface ComposedServerOptions {
  label: string
  info: ComposedServerInfo
  composition: BootComposition
  bundle: { jsPath: string; cssPath?: string }
  setup: (boot: ResolvedBoot) => ComposedServerRuntime | Promise<ComposedServerRuntime>
  /** The OAuth provider the root INSTALLED; never inferred from an env var. */
  oauth?: OAuthProvider<unknown>
  /** Env vars consumed outside the composition (e.g. a secret named in the root's config). */
  extraKnownEnvVars?: Iterable<string>
  /** mcp-use reads `MCP_URL` from `process.env` itself, so production passes `process.env`. */
  env?: NodeJS.ProcessEnv
}

export interface ListenOptions {
  /** `0` binds an ephemeral port. */
  port?: number
  host?: string
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
  builder: boolean
  edge: HttpEdgePolicy
  listen(options?: ListenOptions): Promise<RunningServer>
}

/** Below Fly's default 5 s kill timeout and Docker's 10 s stop grace. */
export const DEFAULT_DRAIN_TIMEOUT_MS = 4000

/** Far above any MCP client's upload, far below Node's 300 s default. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000

const HEALTH_PATH = "/health"
const METRICS_PATH = "/metrics"
const EXEMPT_PATHS = [HEALTH_PATH, METRICS_PATH]

function guardPolicyFor(edge: HttpEdgePolicy, env: NodeJS.ProcessEnv): HttpEdgePolicy {
  return env.MCP_USE_DEV_CLI ? { ...edge, allowedHosts: "*" } : edge
}

/** Behind our own listener a missing OAuth resource would only surface on the first `/mcp` call. */
function assertOAuthResource(
  oauth: OAuthProvider<unknown> | undefined,
  env: NodeJS.ProcessEnv,
  label: string,
): void {
  if (oauth && oauth.resource === undefined && !env.MCP_URL?.trim()) {
    throw new Error(
      `[${label}] OAuth needs MCP_URL — the server's public base URL, which is also the token audience (RFC 8707).`,
    )
  }
}

function serverInstructions(
  options: ComposedServerOptions,
  boot: ResolvedBoot,
): string | undefined {
  const parts = [options.info.instructions?.trim(), options.composition.instructions(boot)]
  const text = parts.filter((part): part is string => Boolean(part)).join("\n\n")
  return text || undefined
}

async function buildFrameworkApp(
  options: ComposedServerOptions,
  boot: ResolvedBoot,
  builder: boolean,
  runtime: ComposedServerRuntime,
  env: NodeJS.ProcessEnv,
): Promise<MCPServer<unknown>> {
  const { info, oauth } = options
  const { title, websiteUrl } = info
  const instructions = serverInstructions(options, boot)
  const csp = fontAssetsCsp(env)
  const frameworkOptions = {
    name: info.name,
    version: info.version,
    description: info.description,
    serverOptions: {
      ...(title ? { title } : {}),
      ...(websiteUrl ? { websiteUrl } : {}),
      ...(instructions ? { instructions } : {}),
    },
    // Cast: the toolkit types `plugins` unparameterized; the factories return `AppPlugin<MCPServer>`.
    plugins: runtime.plugins.map(honorWidgetMetaDefaults) as AppPlugin[],
    appConfig: { activeApps: boot.entries, pipelines: {} },
    app: {
      bundle: options.bundle,
      builder,
      dashboardStore: runtime.dashboardStore,
      ...(csp ? { csp } : {}),
    },
  }
  // Two calls because the oauth/no-oauth overloads are distinct.
  return oauth
    ? await createFrameworkApp({ ...frameworkOptions, oauth })
    : await createFrameworkApp(frameworkOptions)
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
  runtime: ComposedServerRuntime
  state: { draining: boolean }
  drainTimeoutMs: number
}

async function drain(ctx: DrainContext): Promise<void> {
  const { label, app, server, listener } = ctx
  ctx.state.draining = true
  console.info(`[${label}] Draining — ${listener.inFlight} request(s) in flight`)
  const closed = new Promise<void>((resolve) => server.close(() => resolve()))
  server.closeIdleConnections()
  if (!(await settlesWithin(listener.idle(), ctx.drainTimeoutMs))) {
    console.warn(
      `[${label}] Drain timed out after ${ctx.drainTimeoutMs}ms — closing ${listener.inFlight} request(s)`,
    )
  }
  // Closing the MCP handler before the sockets ends streams cleanly instead of resetting them.
  await app.close().catch((error: unknown) => console.error(`[${label}] close failed:`, error))
  server.closeAllConnections()
  await closed
  await ctx.runtime.shutdown?.()
}

function installSignalHandlers(shutdown: () => Promise<void>, label: string): void {
  // `once`: a second signal during the drain kills the process the default way.
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      shutdown().then(
        () => process.exit(0),
        (error: unknown) => {
          console.error(`[${label}] shutdown failed:`, error)
          process.exit(1)
        },
      )
    })
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
    // The guard refuses these whatever their body says — never buffer it.
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
  if (options.handleSignals) installSignalHandlers(shutdown, label)
  return { port: bound, url, shutdown }
}

/** Returns BEFORE listening: `mcp-use dev` serves `app` itself, production calls `listen()`. */
export async function createComposedServer(
  options: ComposedServerOptions,
): Promise<ComposedServer> {
  const { label, composition, oauth, env = process.env } = options
  // mcp-use telemetry is on by default; an ops server must not phone home unless opted in.
  process.env.MCP_USE_ANONYMIZED_TELEMETRY ??= "false"

  composition.warnUnknownEnvVars(env, [...HTTP_EDGE_ENV_VARS, ...(options.extraKnownEnvVars ?? [])])
  const edge = resolveHttpEdgePolicy(env)
  assertOAuthResource(oauth, env, label)

  const boot = composition.resolveBoot(env, { authenticated: oauth !== undefined })
  const builder = frameworkWritesAllowed(boot)
  composition.emitBootWarnings(env)
  const logLevel = requestLogLevelWarning(env)
  if (logLevel) console.warn(`[${label}] ${logLevel}`)
  composition.logEffectiveToolsets(boot)
  if (!builder) {
    console.info(
      `[${label}] Dashboard builder off (needs OAuth and no read-only module) — render-view stays.`,
    )
  }
  console.info(`[${label}] ${describeHttpEdgePolicy(edge)}`)
  const guard = guardPolicyFor(edge, env)
  if (guard !== edge) {
    console.info(
      `[${label}] mcp-use dev: the CLI checks Host (localhost-class + its tunnel); Origin is checked here.`,
    )
  }

  const runtime = await options.setup(boot)
  const app = await buildFrameworkApp(options, boot, builder, runtime, env)
  const state = { draining: false }

  // Request logging is mcp-use's own (`MCP_USE_LOG_LEVEL`).
  installMcpRequestContext(app)
  installToolSchemaTrim(app)
  swallowDevCliViewsPrime(app, env)
  installMetrics(app, { path: METRICS_PATH, token: edge.metricsToken })
  installHttpEdgeGuard(app, guard, { exemptPaths: EXEMPT_PATHS })
  installHealthEndpoints(app, {
    path: HEALTH_PATH,
    readiness: runtime.readiness,
    label,
    draining: () => state.draining,
  })
  // Behind the guard: a font GET passes the Origin half, a foreign Host does not.
  installFontAssets(app, { label })

  return {
    app,
    boot,
    builder,
    edge,
    listen: (listenOptions = {}) =>
      listen({ label, app, guard, env, runtime, state }, listenOptions),
  }
}
