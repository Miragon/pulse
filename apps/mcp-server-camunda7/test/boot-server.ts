import path from "node:path"
import { vi } from "vitest"
import type { MCPServer } from "mcp-use"
import { OAuthError, OAuthErrorCode, oauthCustomProvider, type OAuthProvider } from "mcp-use/oauth"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import {
  createInMemoryProfileStore,
  type ComposedServer,
  type RunningServer,
} from "@miragon/pulse-widget-shell/server"
import { createApp } from "../src/app.js"
import type { RuntimeBackends } from "../src/persistence/index.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

/**
 * Neutral env for every in-process boot: a dummy engine (nothing may reach a
 * real engine or Prometheus), no ambient toolset, OAuth, deployment flag or
 * edge override from the developer's shell — each of those changes the
 * surface under test. Persistence is injected (in-memory), so DATABASE_URL
 * and the store directories never matter.
 */
const BASE_ENV: Record<string, string | undefined> = {
  CAMUNDA_BASE_URL: "http://localhost:1",
  CAMUNDA_ENGINE_ID: undefined,
  CAMUNDA_ENGINE_FLAVOR: undefined,
  CAMUNDA_ENGINES_FILE: undefined,
  CAMUNDA_ENGINES_JSON: undefined,
  CAMUNDA_COCKPIT_URL: undefined,
  CAMUNDA_ALLOW_DEPLOYMENTS: undefined,
  MCP_ACTIVE_MODULES: undefined,
  MCP_OAUTH: undefined,
  MCP_URL: undefined,
  MCP_ALLOWED_HOSTS: undefined,
  MCP_ALLOWED_ORIGINS: undefined,
  MCP_MAX_BODY_BYTES: undefined,
  MCP_METRICS_TOKEN: undefined,
  DATABASE_URL: undefined,
  MCP_PROFILE_DIR: undefined,
  MCP_DASHBOARD_DIR: undefined,
}

/** Bearer tokens the stub IdP accepts, by user id. */
export const TEST_TOKENS = { alice: "e2e-token-alice", bob: "e2e-token-bob" } as const

/**
 * A network-free OAuth provider standing in for Keycloak/Auth0: it accepts
 * exactly {@link TEST_TOKENS}. Installing it runs mcp-use's REAL bearer gate
 * (401 without a token) and the real `ctx.auth` shape, instead of only
 * flipping the selection to "authenticated".
 */
export function createTestOAuthProvider(): OAuthProvider<unknown> {
  const resource = "http://localhost/mcp"
  return oauthCustomProvider<unknown>({
    resource,
    oauthMetadata: {
      issuer: "https://idp.e2e.test",
      authorization_endpoint: "https://idp.e2e.test/authorize",
      token_endpoint: "https://idp.e2e.test/token",
      response_types_supported: ["code"],
    },
    createTokenVerifier: (canonical) => ({
      verifyAccessToken: (token: string) => {
        const user = Object.entries(TEST_TOKENS).find(([, value]) => value === token)?.[0]
        if (!user) {
          return Promise.reject(new OAuthError(OAuthErrorCode.InvalidToken, "unknown e2e token"))
        }
        return Promise.resolve({
          token,
          clientId: "e2e",
          scopes: [],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          resource: canonical,
          extra: { sub: user },
        })
      },
    }),
    // The subject as `id` only — the shape mcp-use's own Keycloak/Auth0
    // providers map; caller resolution must not need any other spelling.
    mapAuthInfo: (authInfo) => {
      const sub = String(authInfo.extra?.sub)
      return { user: { id: sub }, payload: { sub }, permissions: [] }
    },
  })
}

/** In-memory persistence with an observable shutdown — what `initRuntime` returns without DATABASE_URL. */
export function createTestRuntime(overrides: Partial<RuntimeBackends> = {}): RuntimeBackends {
  return {
    profileStore: createInMemoryProfileStore(),
    dashboardStore: undefined,
    readiness: {},
    shutdown: vi.fn(async () => {}),
    ...overrides,
  }
}

/**
 * Modern-envelope MCP client against the in-process server (mcp-use 2 wire).
 * `headers` go out on every request (e.g. a client-chosen `Mcp-Session-Id`).
 */
export async function connectClient(
  port: number,
  token?: string,
  headers: Record<string, string> = {},
): Promise<Client> {
  const client = new Client({ name: "e2e-test", version: "0.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      },
    }),
  )
  return client
}

export interface BootedServer {
  app: MCPServer<unknown>
  composed: ComposedServer
  running: RunningServer
  runtime: RuntimeBackends
  client: Client
  port: number
  /** Stops client + server (graceful drain) and restores the env. */
  close(): Promise<void>
}

export interface BootOptions {
  env?: Record<string, string | undefined>
  /** Install the stub OAuth provider; the client then calls as `alice`. */
  authenticated?: boolean
  runtime?: RuntimeBackends
  drainTimeoutMs?: number
}

/**
 * Boots the REAL composition — `createApp` from `src/app.ts`, i.e. exactly
 * what `src/index.ts` runs (selection, plugins, the Host/Origin guard, the
 * operational routes, the body-capped listener) — on an ephemeral loopback
 * port, with a stand-in widget bundle and in-memory persistence.
 */
export async function bootServer(options: BootOptions = {}): Promise<BootedServer> {
  for (const [name, value] of Object.entries({ ...BASE_ENV, ...options.env })) {
    vi.stubEnv(name, value)
  }
  const runtime = options.runtime ?? createTestRuntime()
  const composed = await createApp(process.env, {
    oauth: options.authenticated ? createTestOAuthProvider() : undefined,
    runtime,
    bundle: { jsPath: FIXTURE_JS },
  })
  const running = await composed.listen({
    port: 0,
    host: "127.0.0.1",
    drainTimeoutMs: options.drainTimeoutMs ?? 1000,
  })
  const client = await connectClient(
    running.port,
    options.authenticated ? TEST_TOKENS.alice : undefined,
  )
  return {
    app: composed.app,
    composed,
    running,
    runtime,
    client,
    port: running.port,
    async close() {
      await client.close()
      await running.shutdown()
      vi.unstubAllEnvs()
    },
  }
}

/** Sorted tool names a booted server advertises. */
export async function listToolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools()
  return tools.map((t) => t.name).sort()
}
