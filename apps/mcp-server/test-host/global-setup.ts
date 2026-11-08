import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { createApp, type AppDeps } from "../src/app.js"
import { MODULES } from "../src/setup.js"
import {
  BROKEN_ENGINE,
  ENGINE_CONTROL_ENV,
  HEALTHY_ENGINE,
  OWN_VIEW_HOST_ENV,
  REALISTIC_ENGINE,
  REALISTIC_HOST_ENV,
} from "./engines.js"
import { startHostBackend, type HostBackend } from "./host-backend.js"
import { ownViewModule } from "./own-view-module.js"
import { startStubEngine } from "./stub-engine.js"
import { startStubPrometheus } from "./stub-prometheus.js"

interface Deployment {
  host: HostBackend
  close(): Promise<void>
}

/**
 * One composition root (`createApp`, i.e. what `src/index.ts` runs) on
 * `env`, with the host's server side in front of it.
 */
async function deploy(env: Record<string, string>, deps?: AppDeps): Promise<Deployment> {
  const composed = await createApp(env, deps)
  const running = await composed.listen({ port: 0, host: "127.0.0.1", drainTimeoutMs: 1000 })
  const client = new Client({ name: "host-sim", version: "1.0.0" })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`)),
  )
  const host = await startHostBackend(client)
  return {
    host,
    close: async () => {
      await host.close()
      await client.close()
      await running.shutdown()
    },
  }
}

/**
 * Boots the system under test once per run: the REAL composition root
 * (`createApp`, i.e. what `src/index.ts` runs: plugins, view resources, the
 * HTTP edge) serving the BUILT widget bundle (`dist/mcp-app.{js,css}`, from
 * `build:ui`), against a stub engine, plus the host's server side in front of
 * it. Everything listens on ephemeral loopback ports: parallel runs in other
 * checkouts can never collide or be reused by accident. The workers find the
 * host page via `HOST_SIM_URL`, the write-capable deployment via
 * `HOST_SIM_OPERATIONS_URL`, the realistic engine's deployment via
 * `HOST_SIM_REALISTIC_URL`, the one with a module's own view via
 * `HOST_SIM_OWN_VIEW_URL` and the stub engine's scenario control via
 * `HOST_SIM_ENGINE_URL` (all inherited from this process).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const engine = await startStubEngine()
  // The analytics views read their figures from it (analytics.spec.ts).
  const prometheus = await startStubPrometheus()
  const engines = {
    ENGINES_JSON: JSON.stringify([
      { id: HEALTHY_ENGINE, baseUrl: engine.baseUrl },
      { id: BROKEN_ENGINE, baseUrl: engine.brokenBaseUrl },
    ]),
    PROMETHEUS_URL: prometheus.url,
  }
  // The default deployment (no OAuth, so every module runs read-only) is the
  // widest audience a view has to work for.
  const readOnly = await deploy(engines)
  // A gateway-fronted deployment naming its toolset: the widget writes are
  // offered (write-refresh.spec.ts).
  const operations = await deploy({ ...engines, MCP_ACTIVE_MODULES: "engine:operations" })
  // Real-sized data on its own deployment (inline-fit.spec.ts), so the other
  // scenarios keep their engine landscape.
  const realistic = await deploy({
    ENGINES_JSON: JSON.stringify([{ id: REALISTIC_ENGINE, baseUrl: engine.realisticBaseUrl }]),
    PROMETHEUS_URL: prometheus.url,
  })
  // A module with a finished HTML view of its own next to the bundle's (own-view.spec.ts).
  const ownView = await deploy(
    { ...engines, MCP_ACTIVE_MODULES: "engine,board" },
    { modules: [...MODULES, ownViewModule] },
  )
  process.env.HOST_SIM_URL = readOnly.host.url
  process.env.HOST_SIM_OPERATIONS_URL = operations.host.url
  process.env[REALISTIC_HOST_ENV] = realistic.host.url
  process.env[OWN_VIEW_HOST_ENV] = ownView.host.url
  process.env[ENGINE_CONTROL_ENV] = engine.controlUrl

  return async () => {
    await readOnly.close()
    await operations.close()
    await realistic.close()
    await ownView.close()
    await prometheus.close()
    await engine.close()
  }
}
