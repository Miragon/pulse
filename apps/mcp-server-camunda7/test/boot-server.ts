import path from "node:path"
import { vi } from "vitest"
import type { MCPServer } from "mcp-use"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import {
  composedEnvVars,
  type ComposedServer,
  type RunningServer,
} from "@miragon/pulse-widget-shell/server"
import { createApp } from "../src/app.js"
import { MODULES } from "../src/setup.js"

const FIXTURE_JS = path.join(import.meta.dirname, "fixtures", "mcp-app.js")

/**
 * The env every in-process boot starts from: EVERY variable the server reads is cleared (the
 * boot's own, OAuth's and each module's slice, `composedEnvVars(MODULES)`) plus every
 * `MCP_USE_OAUTH_*` name, which mcp-use reads itself; then a dead engine URL (nothing may reach
 * a real engine or Prometheus) and `env` are applied. Derived, not hand-listed: a toolset, an
 * engine source, an edge override or an OAuth provider exported in the developer's shell changes
 * the surface under test. `vi.unstubAllEnvs()` undoes it.
 */
export function stubNeutralEnv(env: Record<string, string | undefined> = {}): void {
  const oauthVariables = Object.keys(process.env).filter((name) =>
    name.startsWith("MCP_USE_OAUTH_"),
  )
  for (const name of [...composedEnvVars(MODULES), ...oauthVariables]) vi.stubEnv(name, undefined)
  for (const [name, value] of Object.entries({ CAMUNDA_BASE_URL: "http://localhost:1", ...env })) {
    vi.stubEnv(name, value)
  }
}

/** Modern-envelope MCP client against the in-process server (mcp-use 2 wire). */
async function connectClient(port: number): Promise<Client> {
  const client = new Client({ name: "e2e-test", version: "0.0.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)))
  return client
}

export interface BootedServer {
  app: MCPServer<unknown>
  composed: ComposedServer
  running: RunningServer
  client: Client
  port: number
  /** Stops client + server (graceful drain) and restores the env. */
  close(): Promise<void>
}

export interface BootOptions {
  /** Over the neutral env: a wider surface is an explicit `MCP_ACTIVE_MODULES` suffix. */
  env?: Record<string, string | undefined>
}

/**
 * Boots the REAL composition (`createApp` from `src/app.ts`, exactly what
 * `src/index.ts` runs: selection, plugins, the Host/Origin guard, the
 * operational routes, the body-capped listener) on an ephemeral loopback
 * port, with a stand-in widget bundle.
 */
export async function bootServer(options: BootOptions = {}): Promise<BootedServer> {
  stubNeutralEnv(options.env)
  const composed = await createApp(process.env, { bundle: { jsPath: FIXTURE_JS } })
  const running = await composed.listen({
    port: 0,
    host: "127.0.0.1",
    drainTimeoutMs: 1000,
  })
  const client = await connectClient(running.port)
  return {
    app: composed.app,
    composed,
    running,
    client,
    port: running.port,
    async close() {
      await client.close()
      await running.shutdown()
      vi.unstubAllEnvs()
    },
  }
}
