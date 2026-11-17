import path from "node:path"
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client"
import { createApp, type AppDeps } from "../src/app.js"
import { MODULES } from "../src/setup.js"
import {
  ACCESS_DENIED_ENGINE,
  BOARD_HOST_ENV,
  BROKEN_ENGINE,
  C8_CONTROL_ENV,
  C8_ENGINE,
  C8_OPERATE,
  C8_UNBOARDED_ENGINE,
  CAMUNDA8_HOST_ENV,
  ENGINE_CONTROL_ENV,
  HEALTHY_ENGINE,
  LOGIN_REFUSED_ENGINE,
  ONE_ENGINE_BOARD_HOST_ENV,
  OWN_VIEW_HOST_ENV,
  REALISTIC_ENGINE,
  REALISTIC_HOST_ENV,
  REFUSED_ENGINE,
  REFUSED_HOST_ENV,
} from "./engines.js"
import { startC8HostEngine } from "./c8-engine.js"
import { startHostBackend, type HostBackend } from "./host-backend.js"
import { ownViewModule } from "./own-view-module.js"
import { startStubEngine } from "./stub-engine.js"

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
 * `HOST_SIM_REALISTIC_URL`, the one with a refused profile and refused logins via
 * `HOST_SIM_REFUSED_URL`, the
 * one with a module's own view via
 * `HOST_SIM_OWN_VIEW_URL`, the one with board files via `HOST_SIM_BOARD_URL`, the one with one
 * engine and a board via `HOST_SIM_ONE_ENGINE_BOARD_URL` and the stub engine's
 * scenario control via
 * `HOST_SIM_ENGINE_URL`, and the Camunda 8 deployment via `HOST_SIM_CAMUNDA8_URL` and its
 * cluster's control via `HOST_SIM_C8_ENGINE_URL` (all inherited from this process). The web app's
 * page on this server runs in a suite of its own (`web/`, test:web).
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const engine = await startStubEngine()
  const c8 = await startC8HostEngine()
  const engines = {
    ENGINES_JSON: JSON.stringify({
      profiles: {
        [HEALTHY_ENGINE]: { url: engine.baseUrl },
        [BROKEN_ENGINE]: { url: engine.brokenBaseUrl },
      },
    }),
  }
  // The default deployment (no OAuth, so the engine module runs read-only) is the
  // widest audience a view has to work for.
  const readOnly = await deploy(engines)
  // A gateway-fronted deployment naming its toolset: the widget writes are
  // offered (write-refresh.spec.ts).
  const operations = await deploy({ ...engines, MCP_ACTIVE_MODULES: "engine:operations" })
  // Real-sized data on its own deployment (inline-fit.spec.ts), so the other
  // scenarios keep their engine landscape.
  const realistic = await deploy({
    ENGINES_JSON: JSON.stringify({
      profiles: { [REALISTIC_ENGINE]: { url: engine.realisticBaseUrl } },
    }),
  })
  // A profile the server refuses next to a usable one (refused-profile.spec.ts): its secret's
  // variable is not set, so the landing lists it as not answering and opening it says why. And two
  // engines that refuse the server's Basic login, one with a 401 and one with a 403
  // (refused-login.spec.ts): they answer, so the landing and the cross-engine view never call
  // them unreachable.
  const refused = await deploy({
    ENGINES_JSON: JSON.stringify({
      profiles: {
        [HEALTHY_ENGINE]: { url: engine.baseUrl },
        [REFUSED_ENGINE]: {
          url: engine.baseUrl,
          auth: { type: "bearer", tokenEnv: "ENGINE_SECRET_HOST_SIM_NEVER_SET" },
        },
        [LOGIN_REFUSED_ENGINE]: {
          url: engine.loginRefusedBaseUrl,
          auth: {
            type: "basic",
            username: "demo",
            passwordEnv: "ENGINE_SECRET_HOST_SIM_WRONG_PASSWORD",
          },
        },
        [ACCESS_DENIED_ENGINE]: {
          url: engine.accessDeniedBaseUrl,
          auth: {
            type: "basic",
            username: "viewer",
            passwordEnv: "ENGINE_SECRET_HOST_SIM_VIEWER_PASSWORD",
          },
        },
      },
    }),
    ENGINE_SECRET_HOST_SIM_WRONG_PASSWORD: "not-the-password",
    ENGINE_SECRET_HOST_SIM_VIEWER_PASSWORD: "viewer-password",
  })
  // The board files of fixtures/boards over both engines (board.spec.ts): the board feed and the
  // cockpit's board route, a failed engine in its place, a file that gives no board.
  const boards = await deploy({
    ...engines,
    ENGINE_BOARDS_DIR: path.join(import.meta.dirname, "fixtures", "boards"),
  })
  // One engine beside a board over it (board.spec.ts): the landing, which a single engine never
  // shows without boards, lists the board, and the trail's first crumb leads there.
  const oneEngineBoards = await deploy({
    ENGINES_JSON: JSON.stringify({ profiles: { [HEALTHY_ENGINE]: { url: engine.baseUrl } } }),
    ENGINE_BOARDS_DIR: path.join(import.meta.dirname, "fixtures", "one-engine-boards"),
  })
  // A module with a finished HTML view of its own next to the bundle's (own-view.spec.ts).
  const ownView = await deploy(
    { ...engines, MCP_ACTIVE_MODULES: "engine,board" },
    { modules: [...MODULES, ownViewModule] },
  )
  // Camunda 8 beside the stub (camunda8.spec.ts): a cluster under two profiles of the client
  // credentials grant, one a board names with its Operate, one no board names; the server reads
  // both on boards only, the landing and the gate read nothing of them.
  const camunda8 = await deploy({
    ENGINES_JSON: JSON.stringify({
      profiles: {
        [HEALTHY_ENGINE]: { url: engine.baseUrl },
        [C8_ENGINE]: c8.profile("ENGINE_SECRET_HOST_SIM_C8", { cockpitUrl: C8_OPERATE }),
        [C8_UNBOARDED_ENGINE]: c8.profile("ENGINE_SECRET_HOST_SIM_C8"),
      },
    }),
    ENGINE_SECRET_HOST_SIM_C8: "host-sim-client-secret",
    ENGINE_BOARDS_DIR: path.join(import.meta.dirname, "fixtures", "camunda8-boards"),
  })
  process.env.HOST_SIM_URL = readOnly.host.url
  process.env.HOST_SIM_OPERATIONS_URL = operations.host.url
  process.env[REALISTIC_HOST_ENV] = realistic.host.url
  process.env[REFUSED_HOST_ENV] = refused.host.url
  process.env[OWN_VIEW_HOST_ENV] = ownView.host.url
  process.env[BOARD_HOST_ENV] = boards.host.url
  process.env[ONE_ENGINE_BOARD_HOST_ENV] = oneEngineBoards.host.url
  process.env[ENGINE_CONTROL_ENV] = engine.controlUrl
  process.env[CAMUNDA8_HOST_ENV] = camunda8.host.url
  process.env[C8_CONTROL_ENV] = c8.origin

  return async () => {
    await readOnly.close()
    await operations.close()
    await realistic.close()
    await refused.close()
    await ownView.close()
    await boards.close()
    await oneEngineBoards.close()
    await camunda8.close()
    await engine.close()
    await c8.close()
  }
}
